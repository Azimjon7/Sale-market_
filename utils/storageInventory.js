const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg', '.ico']);

function readArray(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

function normalizeReference(value) {
  const result = String(value || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
  return /^https?:\/\//i.test(result) ? '' : result;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function collectReferences(projectRoot) {
  const products = readArray(path.join(projectRoot, 'data', 'products.json'));
  const orders = readArray(path.join(projectRoot, 'data', 'orders.json'));
  const product = new Set();
  const payment = new Set();
  for (const item of products) {
    [item && item.image, ...(Array.isArray(item && item.images) ? item.images : [])]
      .map(normalizeReference).filter(Boolean).forEach(value => product.add(value));
  }
  for (const order of orders) {
    const value = normalizeReference(order && order.paymentScreenshot);
    if (value) payment.add(value);
  }
  return { product, payment, productCount: products.length, orderCount: orders.length };
}

async function buildStorageInventory(projectRoot) {
  projectRoot = path.resolve(projectRoot);
  const references = collectReferences(projectRoot);
  const files = [];
  for (const folder of ['img', 'uploads']) {
    const start = path.join(projectRoot, folder);
    if (!fs.existsSync(start)) continue;
    const pending = [start];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (entry.isFile()) files.push(absolute);
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  const output = [];
  for (const absolute of files) {
    const reference = path.relative(projectRoot, absolute).replace(/\\/g, '/');
    const stat = fs.statSync(absolute);
    const isImage = IMAGE_EXTENSIONS.has(path.extname(reference).toLowerCase());
    let classification = 'sidecar';
    if (isImage && references.payment.has(reference) && references.product.has(reference)) classification = 'conflict';
    else if (isImage && references.payment.has(reference)) classification = 'private-payment';
    else if (isImage && references.product.has(reference)) classification = 'public-product';
    else if (isImage && reference.startsWith('img/')) classification = 'public-static';
    else if (isImage) classification = 'unreferenced-upload';
    output.push({
      reference, absolutePath: absolute, sizeBytes: stat.size,
      sha256: await sha256File(absolute), modifiedUtc: stat.mtime.toISOString(),
      classification,
    });
  }
  const summary = output.reduce((result, item) => {
    result.allFiles += 1;
    result.allBytes += item.sizeBytes;
    result.byClassification[item.classification] ||= { files: 0, bytes: 0 };
    result.byClassification[item.classification].files += 1;
    result.byClassification[item.classification].bytes += item.sizeBytes;
    if (item.classification !== 'sidecar') { result.imageFiles += 1; result.imageBytes += item.sizeBytes; }
    return result;
  }, { allFiles: 0, allBytes: 0, imageFiles: 0, imageBytes: 0, byClassification: {} });
  return { createdAtUtc: new Date().toISOString(), projectRoot, sourceCounts: { products: references.productCount, orders: references.orderCount }, summary, files: output };
}

module.exports = { IMAGE_EXTENSIONS, buildStorageInventory, collectReferences, sha256File };
