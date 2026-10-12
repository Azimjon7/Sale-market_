#!/usr/bin/env node
'use strict';
/*
 * Local, opt-in BUYO catalog importer for Sale Market.
 * Use only with the content owner's authorization. Does not circumvent access controls.
 * npm install --no-save --ignore-scripts playwright-core
 * node scripts/import-buyo-catalog.js --max-pages=1 --max-products=5 --dry-run
 * node scripts/import-buyo-catalog.js
 */
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTS = path.join(ROOT, 'data', 'products.json');
const CATEGORIES = path.join(ROOT, 'data', 'categories.json');
const BACKUPS = path.join(ROOT, 'data', 'backups');
const IMAGES = path.join(ROOT, 'uploads', 'buyo');
const REPORT = path.join(ROOT, 'data', 'buyo-import-report.json');
const WEBSITE = 'https://buyo.uz';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
const productKey = (name, price) => compact(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') + ':' + Number(price || 0);
const slugFromLink = value => {
  try {
    const u = new URL(String(value), WEBSITE);
    if (!/(^|\.)buyo\.uz$/i.test(u.hostname)) return '';
    const m = u.pathname.match(/^\/(?:uz|ru)\/item\/([^/]+)\/?$/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : '';
  } catch { return ''; }
};
const priceNumber = value => {
  const digits = String(value || '').replace(/[^\d]/g, '');
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : 0;
};
const options = process.argv.slice(2);
const opt = name => options.includes('--' + name);
const optNumber = (name, fallback) => {
  const matched = options.find(a => a.startsWith('--' + name + '='));
  const num = matched ? Number(matched.split('=')[1]) : fallback;
  return Number.isInteger(num) && num > 0 ? num : fallback;
};
const CFG = {
  dryRun: opt('dry-run'),
  refreshImages: opt('refresh-images'),
  noImages: opt('no-images'),
  maxPages: optNumber('max-pages', 30),
  maxProducts: optNumber('max-products', 100000),
  maxImages: Math.min(optNumber('max-images', 3), 5),
  delay: Math.max(optNumber('delay-ms', 800), 400),
  headed: opt('headed')
};

function readList(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data)) throw new Error(file + ' must contain a JSON array');
  return data;
}
function writeJsonAtomic(file, obj) {
  const temp = file + '.temp-' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
}
function categoryFor(label, productName) {
  const s = compact(label).toLowerCase();
  const t = compact(productName).toLowerCase();
  const text = s || t;
  const isShoe = /shoe|footwear|poyabzal|\u043e\u0431\u0443\u0432|\u043a\u0440\u043e\u0441\u0441|\u0441\u0430\u043d\u0434\u0430\u043b/.test(text);
  if (isShoe && /women|woman|ayollar|\u0436\u0435\u043d\u0441\u043a/.test(text)) return 'Ayollar poyabzali';
  if (isShoe && /men|man|erkak|\u043c\u0443\u0436\u0441\u043a/.test(text)) return 'Erkaklar poyabzali';
  const pairs = [
    [/furniture|mebel|\u043c\u0435\u0431\u0435\u043b/, 'Mebel'],
    [/kitchen|oshxona|\u043a\u0443\u0445\u043d|\u043e\u0432\u043e\u0449\u0435\u0440\u0435\u0437/, 'Oshxona'],
    [/clean|tozal|\u0443\u0431\u043e\u0440\u043a|\u0447\u0438\u0441\u0442\u043a/, 'Tozalash'],
    [/light|lamp|yorit|\u043e\u0441\u0432\u0435\u0449|\u0441\u0432\u0435\u0442\u0438\u043b/, 'Yoritish'],
    [/sport|fitness|\u0441\u043f\u043e\u0440\u0442|\u044d\u0441\u043f\u0430\u043d\u0434/, 'Sport'],
    [/baby|child|kid|bolalar|\u0434\u0435\u0442\u0441\u043a|\u0438\u0433\u0440\u0443\u0448/, 'Bolalar'],
    [/electron|\u044d\u043b\u0435\u043a\u0442\u0440|wi-fi|powerbank/, 'Elektronika'],
    [/perfume|parfyum|\u043f\u0430\u0440\u0444\u044e\u043c|\u0434\u0443\u0445\u0438/, 'Parfyumeriya'],
    [/auto|car|avtomobil|\u0430\u0432\u0442\u043e|\u043c\u0430\u0448\u0438\u043d/, 'Avtomobil'],
    [/pet|zoo|hayvon|\u0437\u043e\u043e|\u043f\u0438\u0442\u043e\u043c/, 'Hayvonlar'],
    [/garden|da\u0447|bog|\u0441\u0430\u0434|\u0434\u0430\u0447|\u0441\u0435\u043a\u0430\u0442/, 'Bog\'dorchilik'],
    [/shoe|footwear|poyabzal|\u043e\u0431\u0443\u0432|\u043a\u0440\u043e\u0441\u0441|\u0441\u0430\u043d\u0434\u0430\u043b/, 'Oyoq kiyimlar'],
    [/men|man|erkak|\u043c\u0443\u0436\u0441\u043a/, 'Erkaklar kiyimi'],
    [/women|woman|ayollar|\u0436\u0435\u043d\u0441\u043a/, 'Ayollar kiyimi'],
    [/beaut|cosmetic|go.zallik|\u043a\u043e\u0441\u043c\u0435\u0442|\u043a\u0440\u0435\u043c|skin/, 'Go\u2018zallik'],
    [/bag|sumka|\u0441\u0443\u043c\u043a|\u0440\u044e\u043a\u0437\u0430\u043a/, 'Sumkalar'],
    [/home|uy|\u0434\u043e\u043c|\u0445\u0440\u0430\u043d\u0435\u043d|\u0434\u0435\u043a\u043e\u0440/, 'Uy jihozlari']
  ];
  const broadHome = /^(home|uy jihozlari|\u0442\u043e\u0432\u0430\u0440\u044b \u0434\u043b\u044f \u0434\u043e\u043c\u0430)/.test(s);
  if (broadHome) {
    // Prefer meaningful subcategory from the title when BUYO exposes only a broad breadcrumb.
    for (const [rx, name] of pairs.filter(p => p[1] !== 'Uy jihozlari')) if (rx.test(t)) return name;
  }
  for (const [rx, name] of pairs) if (rx.test(text)) return name;
  if (s) return compact(label).slice(0, 90);
  for (const [rx, name] of pairs) if (rx.test(t)) return name;
  return 'Boshqa mahsulotlar';
}
function sanitizedImage(link) {
  try {
    const url = new URL(link, WEBSITE);
    if (url.protocol !== 'https:' || !/(^|\.)buyo\.uz$/i.test(url.hostname)) return '';
    if (!/\.(webp|png|jpe?g|avif)(?:$|\?)/i.test(url.href)) return '';
    url.search = '';
    return url.href;
  } catch { return ''; }
}
function uniqueImageLinks(urls, limit) {
  const seen = new Set();
  const result = [];
  for (const raw of urls || []) {
    const clean = sanitizedImage(raw);
    if (!clean) continue;
    // Same file at different resolutions is one photo.
    const pathPart = new URL(clean).pathname;
    const key = pathPart.split('/').pop().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= limit) break;
  }
  return result;
}
function normalizeCatalogLink(raw) {
  const slug = slugFromLink(raw);
  return slug ? WEBSITE + '/uz/item/' + encodeURIComponent(slug) : '';
}
function summaryDescription(name, lead, category) {
  const shortLead = compact(lead).replace(/[\r\n]+/g, ' ');
  // Use only the concise, factual product intro; do not copy long creative descriptions.
  if (shortLead.length >= 18 && shortLead.length <= 200 && !/buyo|catalog|katalog|\u043a\u0430\u0442\u0430\u043b\u043e\u0433/i.test(shortLead)) {
    return shortLead;
  }
  return `${name}. ${category} toifasidagi mahsulot. Batafsil xususiyatlarni admin panel orqali tekshiring.`;
}
function safeText(value) {
  return compact(value).replace(/[<>]/g, '');
}
async function navigate(page, url) {
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return true;
    } catch (e) {
      console.warn('  Navigation failed: ' + e.message.slice(0, 130));
      if (i === 0) await sleep(1500);
    }
  }
  return false;
}
async function discoverCatalog(page, maxPages) {
  const out = new Map();
  let emptyPages = 0;
  let unchangedPages = 0;
  let previousSignature = '';
  let completed = false;
  for (let n = 1; n <= maxPages; n++) {
    const url = WEBSITE + '/uz/catalog?page=' + n;
    if (!await navigate(page, url)) break;
    await page.waitForSelector('a[href*="/item/"]', { timeout: 15000 }).catch(() => {});
    await page.evaluate(async () => {
      const wait = t => new Promise(resolve => setTimeout(resolve, t));
      for (let k = 1; k <= 3; k++) {
        window.scrollTo(0, document.body.scrollHeight * k / 3);
        await wait(260);
      }
      window.scrollTo(0, 0);
    }).catch(() => {});
    const entries = await page.evaluate(() => {
      const items = [];
      for (const a of document.querySelectorAll('a[href*="/item/"]')) {
        const u = new URL(a.href, location.href);
        if (!/^\/(ru|uz)\/item\//.test(u.pathname)) continue;
        const card = a.closest('article, li, [class*="product"], [class*="Product"]') || a;
        const first = card.querySelector('img');
        items.push({ url: u.origin + u.pathname, fallbackImage: first?.currentSrc || first?.src || '', category: card.getAttribute('data-category') || '' });
      }
      return items;
    });
    const slugs = [...new Set(entries.map(e => slugFromLink(e.url)).filter(Boolean))];
    const signature = slugs.slice(0, 15).join(',');
    console.log('Catalog page ' + n + ': ' + slugs.length + ' products');
    if (!slugs.length) {
      emptyPages++;
      if (emptyPages >= 2) { completed = true; break; }
      continue;
    }
    emptyPages = 0;
    if (signature === previousSignature) unchangedPages++;
    else unchangedPages = 0;
    if (unchangedPages >= 1) {
      console.warn('Catalog pages are repeating; pagination may have changed. Stopping to avoid false duplicates.');
      break;
    }
    previousSignature = signature;
    let addedThisPage = 0;
    for (const entry of entries) {
      const slug = slugFromLink(entry.url);
      if (!slug || out.has(slug)) continue;
      out.set(slug, { slug, url: normalizeCatalogLink(entry.url), fallbackImage: entry.fallbackImage, category: entry.category });
      addedThisPage++;
    }
    if (!addedThisPage) {
      console.warn('No new products on page ' + n + '.');
      break;
    }
    await sleep(CFG.delay);
  }
  return { entries: [...out.values()], completed, pagesRequested: maxPages };
}
async function scrapeProduct(page, entry) {
  if (!await navigate(page, entry.url)) return { error: 'page could not be opened' };
  await page.waitForSelector('h1', { timeout: 11000 }).catch(() => {});
  await sleep(650);
  const data = await page.evaluate(() => {
    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
    const meta = (name, attr = 'property') => document.querySelector(`meta[${attr}="${name}"]`)?.getAttribute('content') || '';
    const h1 = document.querySelector('h1');
    const name = clean(h1?.innerText || meta('og:title') || document.title.replace(/\s*\|.*/, ''));
    const main = h1?.closest('main') || document.querySelector('main') || document.body;
    const crumbs = [...main.querySelectorAll('a[href*="/category/"]')];
    const category = clean(crumbs.length ? crumbs[crumbs.length - 1].innerText : '');
    let ldProduct = null;
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const root = JSON.parse(el.textContent || '{}');
        const nodes = Array.isArray(root) ? root : root['@graph'] ? root['@graph'] : [root];
        const p = nodes.find(n => (Array.isArray(n['@type']) ? n['@type'].includes('Product') : n['@type'] === 'Product'));
        if (p) { ldProduct = p; break; }
      } catch {}
    }
    const srcs = [];
    const addSrc = raw => {
      if (!raw) return;
      for (const item of String(raw).split(',')) {
        const url = item.trim().split(/\s+/)[0].replace(/\\\//g, '/');
        if (/media\.buyo\.uz\/products\//.test(url)) srcs.push(url);
      }
    };
    if (ldProduct?.image) (Array.isArray(ldProduct.image) ? ldProduct.image : [ldProduct.image]).forEach(addSrc);
    addSrc(meta('og:image'));
    for (const node of document.querySelectorAll('img, source, video[poster]')) {
      for (const attr of ['src', 'srcset', 'data-src', 'data-srcset', 'data-original', 'poster']) addSrc(node.getAttribute(attr));
      if (node.tagName === 'IMG') addSrc(node.currentSrc);
    }
    // Some product galleries store non-active slides in hydration JSON rather than IMG tags.
    const scriptImageRe = /https?:\\?\/\\?\/media\.buyo\.uz\\?\/products\\?\/\d+\\?\/[^"'\s<>\\]+?\.(?:webp|jpe?g|png|avif)/gi;
    for (const script of document.querySelectorAll('script:not([src])')) {
      const text = script.textContent || '';
      if (text.length > 2500000) continue;
      const matches = text.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').match(scriptImageRe) || [];
      matches.forEach(addSrc);
    }
    // Include only actual product image gallery, never recommendations from a different product.
    const idRx = srcs.map(u => u.match(/\/products\/(\d+)\//)?.[1]).find(Boolean);
    const images = srcs.filter(u => !idRx || u.includes('/products/' + idRx + '/'));
    const allText = clean(main.innerText || document.body.innerText);
    const h1Index = name ? allText.indexOf(name) : 0;
    const head = allText.slice(Math.max(0, h1Index), Math.max(0, h1Index) + 1700);
    const moneyRegex = /(\d[\d\s\u00a0\u202f\u2009.,]*?)\s*(?:so[\u02bb\u2019']?m|\u0441\u0443\u043c)(?!\w)/gi;
    const prices = [...head.matchAll(moneyRegex)].map(m => Number(m[1].replace(/\D/g, ''))).filter(n => n >= 1000 && n < 1e10);
    const uniquePrices = [...new Set(prices)];
    const ldOffer = Array.isArray(ldProduct?.offers) ? ldProduct.offers[0] : ldProduct?.offers;
    const ldPrice = ldOffer?.price != null ? Number(String(ldOffer.price).replace(/[^\d.]/g,'')) : 0;
    const firstPrices = uniquePrices.slice(0, 2);
    const price = ldPrice > 1000 ? ldPrice : (firstPrices.length ? Math.min(...firstPrices) : 0);
    const oldPrice = uniquePrices.find(p => p > price) || 0;
    const descriptionEl = main.querySelector('[itemprop="description"], [class*="description"], [class*="Description"]');
    const next = h1?.parentElement?.nextElementSibling;
    const intro = clean(ldProduct?.description || (next && next.textContent.length < 280 ? next.innerText : '') || meta('og:description') || meta('description', 'name'));
    const unavailable = /\u041d\u0435\u0442 \u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438|Sotuvda mavjud emas|Omborda yo.q/i.test(head);
    const body = clean(descriptionEl?.innerText || '');
    return { name, category, price, oldPrice, intro, body: body.slice(0, 500), images, sourceName: ldProduct?.name || '', unavailable };
  });
  if (!data.name || data.name.length < 3 || !data.price) return { error: 'missing reliable name/price', data };
  const category = categoryFor(data.category || entry.category, data.name);
  const imageUrls = uniqueImageLinks([...data.images, entry.fallbackImage], CFG.maxImages);
  if (!imageUrls.length) return { error: 'no verifiable product image', data };
  const label = data.oldPrice > data.price ? 'Chegirma' : 'Yangi';
  return {
    product: {
      id: 'buyo_' + entry.slug.replace(/[^a-z0-9_-]/g, '').slice(0, 70),
      name: safeText(data.name).slice(0, 180),
      price: data.price,
      oldPrice: data.oldPrice > data.price ? data.oldPrice : 0,
      category: safeText(category).replace(/"/g, ''),
      desc: safeText(summaryDescription(data.name, data.intro, category)),
      image: imageUrls[0], images: imageUrls,
      sizes: [], colors: [],
      stock: data.unavailable ? 0 : 1,
      label,
      createdAt: new Date().toISOString(),
      tags: [category, data.name].filter(Boolean),
      sourceName: 'BUYO', sourceUrl: entry.url,
      sourceImages: imageUrls
    }
  };
}
async function browserImageFallback(page, address) {
  // Normal browser IMG loading, without special credentials or access-control bypass.
  const pending = page.waitForResponse(
    response => response.url().split('?')[0] === address && response.ok(),
    { timeout: 4000 }
  );
  await page.evaluate(url => {
    const img = document.createElement('img');
    img.style.display = 'none';
    img.src = url;
    document.body.appendChild(img);
    setTimeout(() => img.remove(), 10000);
  }, address);
  const response = await pending;
  const mime = response.headers()['content-type'] || '';
  if (!mime.startsWith('image/')) throw new Error('browser returned non-image');
  return response.body();
}
async function downloadGallery(context, product, page) {
  const photos = product.sourceImages || product.images;
  if (CFG.noImages || CFG.dryRun || !photos.length) return product;
  const local = [];
  for (let i = 0; i < Math.min(photos.length, CFG.maxImages); i++) {
    const address = photos[i];
    const ext = path.extname(new URL(address).pathname).toLowerCase() || '.webp';
    // Use the same naming scheme as the existing gallery cache utility.
    const file = path.join(IMAGES, product.id + '-' + String(i + 1) + ext);
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) {
      local.push(rel);
      continue;
    }
    try {
      let body;
      try {
        const response = await context.request.get(address, { timeout: 16000, headers: { Referer: WEBSITE + '/' } });
        if (!response.ok()) throw new Error('HTTP ' + response.status());
        const mime = response.headers()['content-type'] || '';
        if (!mime.startsWith('image/')) throw new Error('not an image: ' + mime);
        body = await response.body();
      } catch (primaryError) {
        if (!page) throw primaryError;
        body = await browserImageFallback(page, address);
      }
      if (body.length < 1024 || body.length > 8 * 1024 * 1024) throw new Error('unexpected image size: ' + body.length);
      fs.mkdirSync(IMAGES, { recursive: true });
      fs.writeFileSync(file, body);
      local.push(rel);
    } catch (error) {
      console.warn('  Could not download photo ' + (i + 1) + ' of ' + product.id + ': ' + error.message.slice(0, 110));
      // Keep the public URL as a fallback; do not pretend it was saved locally.
      local.push(address);
    }
  }
  const verified = local.filter(p => p.startsWith('uploads/') && fs.existsSync(path.join(ROOT, p)));
  product.images = local;
  product.image = local[0] || product.image;
  product.localImageCount = verified.length;
  return product;
}
async function launchBrowser(chromium) {
  const choices = [{ channel: 'chrome' }, { channel: 'msedge' }, {}];
  let last;
  for (const c of choices) {
    try { return await chromium.launch({ headless: !CFG.headed, ...c }); }
    catch (e) { last = e; }
  }
  throw new Error('Could not start Chrome/Edge. Install Chrome or run npx playwright install chromium. ' + (last?.message || ''));
}
async function main() {
  if (!fs.existsSync(PRODUCTS)) throw new Error('Missing data/products.json. Run from inside the Sale Market project.');
  const original = readList(PRODUCTS);
  const existing = new Map(original.map(p => [slugFromLink(p.sourceUrl), p]).filter(row => row[0]));
  const existingByImageId = new Map();
  const existingByName = new Set(original.map(p => productKey(p.name, p.price)));
  for (const p of original) {
    const links = [p.image, ...(p.images || []), ...(p.sourceImages || [])];
    const id = links.map(x => String(x || '').match(/\/products\/(\d+)\//)?.[1]).find(Boolean);
    if (id) existingByImageId.set(id, p);
  }
  let playwright;
  try { playwright = require('playwright-core'); }
  catch { throw new Error('Missing playwright-core. Run: npm install --no-save --ignore-scripts playwright-core'); }
  const browser = await launchBrowser(playwright.chromium);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'uz-UZ', serviceWorkers: 'block' });
  const catalog = await context.newPage();
  const failures = [];
  const changed = [];
  const current = [...original];
  const categories = new Set(readList(CATEGORIES));
  const stats = { previousCount: original.length, totalFound: 0, alreadyInSaleMarket: 0, newlyImported: 0, updatedGalleries: 0, skippedDuplicates: 0, localImagesSaved: 0, pagesComplete: false };
  let checkpointMade = false;
  const checkpoint = () => {
    if (CFG.dryRun || !changed.length) return;
    if (!checkpointMade) {
      fs.mkdirSync(BACKUPS, { recursive: true });
      fs.copyFileSync(PRODUCTS, path.join(BACKUPS, 'products-before-buyo-import-' + Date.now() + '.json'));
      checkpointMade = true;
    }
    writeJsonAtomic(PRODUCTS, current);
    writeJsonAtomic(CATEGORIES, [...categories]);
  };
  try {
    console.log('BUYO catalog import. Existing products: ' + original.length + ', dry run: ' + CFG.dryRun);
    const discovery = await discoverCatalog(catalog, CFG.maxPages);
    stats.totalFound = discovery.entries.length;
    stats.pagesComplete = discovery.completed;
    console.log('Discovered ' + discovery.entries.length + ' unique product links.');
    if (!discovery.entries.length) throw new Error('No item URLs found. The website layout may have changed; no data was modified.');
    const todo = discovery.entries.filter(e => !existing.has(e.slug) || (CFG.refreshImages && (existing.get(e.slug).images || []).length < 3));
    stats.alreadyInSaleMarket = discovery.entries.length - todo.filter(e => !existing.has(e.slug)).length;
    const limited = todo.slice(0, CFG.maxProducts);
    const page = await context.newPage();
    for (let i = 0; i < limited.length; i++) {
      const entry = limited[i];
      const isExisting = existing.has(entry.slug);
      const label = `[${i + 1}/${limited.length}] ` + entry.slug;
      try {
        const result = await scrapeProduct(page, entry);
        if (result.error) {
          failures.push({ url: entry.url, reason: result.error });
          console.warn(label + ': SKIPPED - ' + result.error);
          continue;
        }
        if (isExisting) {
          const target = existing.get(entry.slug);
          const enriched = await downloadGallery(context, { ...result.product, id: target.id }, page);
          if (!CFG.dryRun) {
            const merged = [...new Set([...(target.images || []), ...enriched.images])].slice(0, CFG.maxImages);
            target.images = merged;
            target.image = target.image || merged[0];
            target.sourceImages = [...new Set([...(target.sourceImages || []), ...enriched.sourceImages])];
          }
          stats.updatedGalleries++;
          changed.push(entry.slug);
          console.log(label + ': UPDATED GALLERY');
        } else {
          const imageId = result.product.sourceImages.map(x => x.match(/\/products\/(\d+)\//)?.[1]).find(Boolean);
          if (imageId && existingByImageId.has(imageId)) {
            console.log(label + ': DUPLICATE (same BUYO product image ID)');
            stats.skippedDuplicates++;
            continue;
          }
          if (existingByName.has(productKey(result.product.name, result.product.price))) {
            console.log(label + ': DUPLICATE (same name and price)');
            stats.skippedDuplicates++;
            continue;
          }
          const product = await downloadGallery(context, result.product, page);
          current.push(product);
          existing.set(entry.slug, product);
          existingByName.add(productKey(product.name, product.price));
          if (imageId) existingByImageId.set(imageId, product);
          categories.add(product.category);
          changed.push(entry.slug);
          stats.newlyImported++;
          stats.localImagesSaved += Number(product.localImageCount || 0);
          console.log(label + ': ADDED ' + product.name + ' (' + (product.localImageCount || 0) + ' local images, ' + product.images.length + ' total URLs)');
        }
        if (changed.length % 15 === 0) checkpoint();
      } catch (e) {
        failures.push({ url: entry.url, reason: e.message });
        console.warn(label + ': ERROR - ' + e.message.slice(0, 150));
      }
      await sleep(CFG.delay);
    }
    await page.close();
    checkpoint();
  } finally {
    await browser.close();
    stats.finalCount = current.length;
    stats.errors = failures.length;
    const result = { checkedAt: new Date().toISOString(), ...stats, incomplete: !stats.pagesComplete, failures };
    if (!CFG.dryRun) writeJsonAtomic(REPORT, result);
    console.log('\nImport result:\n' + JSON.stringify(result, null, 2).slice(0, 3000));
    if (!stats.pagesComplete) console.warn('WARNING: Complete coverage not verified. Review data/buyo-import-report.json and any pagination errors.');
    if (CFG.dryRun) console.log('Dry-run: data/products.json was NOT changed.');
    else console.log('Restart npm start, then check /api/products. Review stock and usage rights before selling.');
  }
}
if (require.main === module) main().catch(e => { console.error('\nIMPORT FAILED:', e.message); process.exitCode = 1; });
module.exports = { slugFromLink, priceNumber, categoryFor, sanitizedImage, uniqueImageLinks, summaryDescription, normalizeCatalogLink };
