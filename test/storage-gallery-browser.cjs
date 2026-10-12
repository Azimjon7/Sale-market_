const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'storage-gallery-browser-secret-at-least-32-chars';
process.env.ADMIN_USERNAME = 'storage-browser-admin';
process.env.ADMIN_PASSWORD = 'storage-browser-password';
const { createApp } = require('../server');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dodola-gallery-browser-'));
const dataDir = path.join(fixture, 'data');
const uploadsDir = path.join(fixture, 'uploads');
fs.mkdirSync(path.join(uploadsDir, 'gallery'), { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
for (let i = 1; i <= 3; i += 1) fs.writeFileSync(path.join(uploadsDir, 'gallery', `${i}.png`), PNG);
const images = [1, 2, 3].map(i => `uploads/gallery/${i}.png`);
const product = { id: 'gallery-product', sku: 'DOD-0001', name: 'Galereya sinovi', category: 'Sinov', desc: 'Izolyatsiyalangan rasm testi', price: 1000, image: images[0], images, _inventoryMode: 'made-to-order', stock: 0 };
for (const [name, value] of Object.entries({ products: [product], orders: [], categories: ['Sinov'], promocodes: [], reviews: [], customers: [], 'auth-tokens': [], 'customer-sessions': {}, 'identifier-counters': { nextSku: 2, nextOrderNumber: 1001 } })) {
  fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(value));
}

(async () => {
  const app = createApp({ dataDir, uploadsDir, notifyOrder: async () => {}, env: { ...process.env, FILE_STORAGE_BACKEND: 'local' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/product-details.html?id=gallery-product`);
      await page.locator('#pdMainImage').waitFor();
      assert.equal(await page.locator('.pd-thumb').count(), 3);
      assert.equal(await page.locator('#pdMainImage').evaluate(image => image.complete && image.naturalWidth > 0), true);
      await page.locator('.pd-thumb').nth(2).click();
      assert.equal(await page.locator('#pdMainImage').getAttribute('src'), images[2]);
      assert.equal(await page.locator('.pd-thumb.active').getAttribute('data-index'), '2');
      assert.deepEqual(errors, []);
      await page.close();
    }
    assert.equal((await fetch(`${base}/uploads/gallery/1.png`)).status, 200);
    fs.writeFileSync(path.join(uploadsDir, 'unreferenced.png'), PNG);
    assert.equal((await fetch(`${base}/uploads/unreferenced.png`)).status, 404);
    console.log(JSON.stringify({ passed: 8, failed: 0, fixture }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
