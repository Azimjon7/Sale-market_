const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const IMAGE_EXTENSIONS = ['.webp', '.jpg', '.jpeg', '.png', '.avif', '.gif'];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function atomicWriteJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function isBuyoPage(value) {
  if (!isHttpUrl(value)) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'buyo.uz' || host === 'www.buyo.uz';
  } catch (_) { return false; }
}

function isBuyoMedia(value) {
  if (!isHttpUrl(value)) return false;
  try { return new URL(value).hostname.toLowerCase() === 'media.buyo.uz'; }
  catch (_) { return false; }
}

function uniq(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function safeId(value) {
  return String(value || 'product').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'product';
}

function productNumberFromUrls(product) {
  const values = [product.image, product.sourceImage]
    .concat(Array.isArray(product.images) ? product.images : [])
    .concat(Array.isArray(product.sourceImages) ? product.sourceImages : []);
  for (const value of values) {
    const match = String(value || '').match(/media\.buyo\.uz\/products\/(\d+)\//i);
    if (match) return match[1];
  }
  return '';
}

function normalizeHtml(html) {
  return String(html || '')
    .replace(/\\u002f/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
}

function extractBuyoMediaUrls(html, productNumber) {
  const normalized = normalizeHtml(html);
  const matches = normalized.match(/https:\/\/media\.buyo\.uz\/products\/\d+\/[^\s"'<>\\)\]]+/gi) || [];
  const cleaned = matches.map((url) => url.replace(/[.,;:]+$/g, ''));
  const filtered = productNumber
    ? cleaned.filter((url) => url.includes(`/products/${productNumber}/`))
    : cleaned;

  // Prefer catalog/detail imagery, then other product-specific media.
  const score = (url) => {
    if (/\/c\/s\/1\//i.test(url)) return 0;
    if (/\/c\/s\/2\//i.test(url)) return 1;
    if (/\/c\/s\/3\//i.test(url)) return 2;
    if (/\/i\//i.test(url)) return 3;
    return 4;
  };
  return uniq(filtered).sort((a, b) => score(a) - score(b));
}

function chooseExtension(url, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('webp')) return '.webp';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('png')) return '.png';
  if (type.includes('avif')) return '.avif';
  if (type.includes('gif')) return '.gif';
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  } catch (_) {}
  return '.webp';
}

function request(url, { accept = '*/*', referer = 'https://buyo.uz/', timeout = 25000, maxBytes = 15 * 1024 * 1024 } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch (err) { return reject(err); }
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get(parsed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
        'Accept': accept,
        'Accept-Language': 'uz-UZ,uz;q=0.9,ru;q=0.8,en;q=0.7',
        'Referer': referer,
      },
      timeout,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        const redirected = new URL(res.headers.location, url).toString();
        return resolve(request(redirected, { accept, referer, timeout, maxBytes }, redirects + 1));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${status}`));
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          req.destroy(new Error('Response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
  });
}

async function fetchPage(url) {
  const result = await request(url, { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', referer: 'https://buyo.uz/' });
  return result.buffer.toString('utf8');
}

function findExistingSlot(cacheDir, id, slot) {
  const prefix = `${safeId(id)}-${slot}`;
  if (!fs.existsSync(cacheDir)) return null;
  const file = fs.readdirSync(cacheDir).find((name) => {
    const ext = path.extname(name).toLowerCase();
    return name.startsWith(`${prefix}.`) && IMAGE_EXTENSIONS.includes(ext);
  });
  if (!file) return null;
  const abs = path.join(cacheDir, file);
  try {
    if (fs.statSync(abs).size > 255) return `uploads/buyo/${file}`;
  } catch (_) {}
  return null;
}

async function downloadSlot({ url, sourcePage, cacheDir, productId, slot }) {
  if (!isBuyoMedia(url)) throw new Error('Blocked non-BUYO media host');
  const existing = findExistingSlot(cacheDir, productId, slot);
  if (existing) return existing;

  const result = await request(url, {
    accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    referer: isBuyoPage(sourcePage) ? sourcePage : 'https://buyo.uz/',
  });
  if (!String(result.contentType || '').toLowerCase().startsWith('image/')) {
    throw new Error(`Unexpected content type: ${result.contentType || 'unknown'}`);
  }
  if (result.buffer.length < 256) throw new Error('Image is too small');
  const ext = chooseExtension(url, result.contentType);
  const name = `${safeId(productId)}-${slot}${ext}`;
  const abs = path.join(cacheDir, name);
  const tmp = `${abs}.part`;
  fs.writeFileSync(tmp, result.buffer);
  fs.renameSync(tmp, abs);
  return `uploads/buyo/${name}`;
}

function localPathExists(projectRoot, value) {
  if (typeof value !== 'string' || /^https?:\/\//i.test(value)) return false;
  try { return fs.existsSync(path.join(projectRoot, value)); } catch (_) { return false; }
}

async function cacheBuyoGalleryImages({ projectRoot, maxImages = 3, skipCompleted = false } = {}) {
  projectRoot = projectRoot || path.join(__dirname, '..');
  const productsFile = path.join(projectRoot, 'data', 'products.json');
  const cacheDir = path.join(projectRoot, 'uploads', 'buyo');
  const manifestFile = path.join(cacheDir, 'gallery-manifest.json');
  fs.mkdirSync(cacheDir, { recursive: true });

  const products = readJson(productsFile, []);
  if (!Array.isArray(products)) throw new Error('data/products.json must contain an array');
  const oldManifest = readJson(manifestFile, { products: {} });
  const manifest = {
    updatedAt: new Date().toISOString(),
    maxImages,
    products: { ...(oldManifest.products || {}) },
  };

  let changed = false;
  let downloaded = 0;
  let reused = 0;
  let failed = 0;
  let pagesFetched = 0;

  for (const product of products) {
    if (!product || typeof product !== 'object') continue;
    if (!(String(product.sourceName || '').toUpperCase() === 'BUYO' || isBuyoPage(product.sourceUrl))) continue;

    const pid = String(product.id || '');
    const previous = manifest.products[pid];
    const currentImages = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    const currentLocal = currentImages.filter((img) => localPathExists(projectRoot, img));
    if (skipCompleted && previous && previous.complete && currentLocal.length === previous.localCount) continue;

    const remoteSeed = uniq(
      (Array.isArray(product.sourceImages) ? product.sourceImages : [])
        .concat(currentImages.filter(isHttpUrl))
        .concat([product.sourceImage, product.image].filter(isHttpUrl))
    ).filter(isBuyoMedia);

    let discovered = [];
    let pageError = '';
    // When products.json already contains a verified 3-image gallery, use it
    // directly. This makes Render postinstall faster and avoids unnecessary
    // product-page scraping. Fall back to page discovery only when needed.
    if (remoteSeed.length < maxImages && isBuyoPage(product.sourceUrl)) {
      try {
        const html = await fetchPage(product.sourceUrl);
        pagesFetched += 1;
        discovered = extractBuyoMediaUrls(html, productNumberFromUrls(product));
      } catch (err) {
        pageError = err.message || String(err);
      }
    }

    const candidates = uniq(remoteSeed.concat(discovered));
    const sourceImages = [];
    const localImages = [];
    let cursor = 0;

    for (let slot = 1; slot <= maxImages; slot += 1) {
      const existing = findExistingSlot(cacheDir, pid, slot);
      if (existing) {
        localImages.push(existing);
        const oldSource = Array.isArray(product.sourceImages) ? product.sourceImages[slot - 1] : null;
        if (oldSource) sourceImages.push(oldSource);
        reused += 1;
        continue;
      }

      let saved = null;
      while (cursor < candidates.length && !saved) {
        const source = candidates[cursor++];
        try {
          saved = await downloadSlot({ url: source, sourcePage: product.sourceUrl, cacheDir, productId: pid, slot });
          sourceImages.push(source);
          downloaded += 1;
        } catch (err) {
          failed += 1;
          console.warn(`[gallery-cache] ${pid} image failed: ${source} (${err.message})`);
        }
      }
      if (saved) localImages.push(saved);
      else break;
    }

    if (localImages.length) {
      const originalMain = isHttpUrl(product.image) ? product.image : (product.sourceImage || '');
      const originalSources = uniq(
        (Array.isArray(product.sourceImages) ? product.sourceImages : [])
          .concat(remoteSeed)
          .concat(sourceImages)
      );
      product.image = localImages[0];
      product.images = localImages;
      if (originalMain) product.sourceImage = originalMain;
      product.sourceImages = originalSources.slice(0, Math.max(maxImages, originalSources.length));
      changed = true;
    }

    manifest.products[pid] = {
      name: product.name || '',
      sourceUrl: product.sourceUrl || '',
      discovered: candidates.length,
      localCount: localImages.length,
      localImages,
      sourceImages: uniq(sourceImages.length ? sourceImages : remoteSeed).slice(0, maxImages),
      complete: !pageError && localImages.length > 0 && localImages.length >= Math.min(maxImages, candidates.length || localImages.length),
      pageError,
      checkedAt: new Date().toISOString(),
    };

    console.log(`[gallery-cache] ${pid}: ${localImages.length}/${maxImages} local image(s)`);
  }

  if (changed) atomicWriteJson(productsFile, products);
  atomicWriteJson(manifestFile, manifest);
  return { products: products.length, downloaded, reused, failed, pagesFetched, changed };
}

module.exports = { cacheBuyoGalleryImages, extractBuyoMediaUrls };
