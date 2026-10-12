// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
// Uses a random localhost port and synthetic storage. Never opens .env or real data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'four-flows-isolated-test-secret-not-for-production';
process.env.ADMIN_USERNAME = 'isolated-admin';
process.env.ADMIN_PASSWORD = 'isolated-browser-password';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
const { createApp } = require('../server');
const { migrateIdentifiers } = require('../scripts/migrate-identifiers');
const { initializeProductInventory } = require('../utils/stockReservation');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, '.local-tests', 'four-flows-' + crypto.randomUUID());
const dataDir = path.join(fixture, 'data'), uploadsDir = path.join(fixture, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
const product = (id, mode, stock, category = 'Test') => ({ id, name: 'Test ' + id, category,
  price: 100000, stock, _inventoryMode: mode, _productionDays: 14,
  sizes: ['Standart'], colors: ['Oq'], image: 'img/placeholders/product.svg', images: ['img/placeholders/product.svg'] });
const products = [product('mto', 'made-to-order', 0), product('standard', 'standard', 3), product('standard-mobile', 'standard', 3),
  product('soldout', 'standard', 0), { ...product('range', 'standard', 10), sizes: 'M-3XL', colors: "To'q ko'k, Qora-oq" },
  initializeProductInventory(product('warehouse', 'standard', 6), 6, 'test', '2026-01-01T00:00:00.000Z').product,
  ...Array.from({ length: 5 }, (_, i) => product('other-' + i, 'made-to-order', 0, 'Other'))];
const write = (name, value) => fs.writeFileSync(path.join(dataDir, name + '.json'), JSON.stringify(value));
const read = name => JSON.parse(fs.readFileSync(path.join(dataDir, name + '.json')));
write('products', products); write('orders', []); write('categories', ['Test', 'Other']); write('promocodes', []); write('reviews', []);
const results = [], errors = [];
let browser, server, base;
let browserAdminToken = '';
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
}
async function pageFor(url, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push({ url: page.url(), error: e.message }));
  await page.goto(base + url);
  return page;
}
async function checkout(page) {
  await page.goto(base + '/checkout.html');
  await page.locator('.checkout-summary-row').first().waitFor();
  await page.locator('#name').fill('Synthetic Browser Customer');
  await page.locator('#phone').fill('+998900000000');
  await page.locator('#address').fill('Isolated browser test address');
}
async function submit(page) {
  await page.getByRole('button', { name: 'Buyurtma berish', exact: true }).click();
}
async function login(page) {
  if (browserAdminToken) {
    await page.evaluate(token => {
      localStorage.setItem('mb_admin_logged_in', 'true');
      localStorage.setItem('mb_admin_token', token);
    }, browserAdminToken);
    await page.reload();
    await page.locator('#adminApp').waitFor({ state: 'visible' });
    return;
  }
  await page.locator('#username').fill(process.env.ADMIN_USERNAME);
  await page.locator('#password').fill(process.env.ADMIN_PASSWORD);
  await page.locator('#loginBtn').click();
  await page.locator('#adminApp').waitFor({ state: 'visible' });
  browserAdminToken = await page.evaluate(() => localStorage.getItem('mb_admin_token'));
}
(async () => {
  await migrateIdentifiers({ projectRoot: fixture, dataDir });
  server = createApp({ dataDir, uploadsDir, notifyOrder: async () => {} }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
  await check('SKU appears on cards/details, copies, and is searchable', async () => {
    const page = await pageFor('/product-details.html?id=mto');
    await page.locator('.pd-sku-code').waitFor();
    assert.equal((await page.locator('.pd-sku-code').innerText()).trim(), 'SKU: DOD-0001');
    await page.locator('#copySkuBtn').click();
    assert.match(await page.locator('#copySkuBtn').innerText(), /Nusxalandi/);
    await page.goto(base + '/?search=DOD-0001');
    await page.locator('.sm-product-sku').first().waitFor();
    assert.equal(await page.locator('.js-add-card').count(), 1);
    await page.context().close();
  });
  await check('Desktop MTO details -> cart -> checkout -> saved order', async () => {
    const page = await pageFor('/product-details.html?id=mto');
    await page.locator('#qtyInput').fill('2');
    await page.locator('#addToCartBtn').click();
    assert.match(await page.locator('#pdMessage').innerText(), /korzinaga qo'shildi/);
    const cart = await page.evaluate(() => MBStore.getCart());
    assert.equal(cart[0].qty, 2); assert.equal(cart[0].product._inventoryMode, 'made-to-order');
    await page.goto(base + '/shop-cart.html');
    await page.getByText('Test mto', { exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(fixture, 'cart-desktop.png'), fullPage: true });
    await checkout(page);
    assert.equal(await page.locator('#mtoPaymentNotice').isVisible(), true);
    await page.screenshot({ path: path.join(fixture, 'checkout-desktop.png'), fullPage: true });
    await submit(page); await page.waitForURL('**/success.html?**');
    const orderNumber = new URL(page.url()).searchParams.get('orderNumber');
    assert.equal((await page.locator('#successOrderId').innerText()).trim(), orderNumber);
    assert.ok(read('orders').some(o => o.orderNumber === orderNumber && o.status === 'pending_confirmation'));
    assert.equal(read('products')[0].stock, 0);
    assert.equal((await page.evaluate(() => MBStore.getCart())).length, 0);
    await page.goto(base + '/track-order.html?orderNumber=' + encodeURIComponent(orderNumber));
    await page.getByRole('button', { name: 'Buyurtmani tekshirish' }).click();
    await page.locator('.track-result').waitFor();
    const trackingText = await page.locator('.track-result').innerText();
    assert.ok(trackingText.includes(orderNumber));
    assert.ok(!trackingText.includes('Synthetic Browser Customer'));
    assert.ok(!trackingText.includes('+998900000000'));
    assert.ok(!trackingText.includes('Isolated browser test address'));
    await page.context().close();
  });
  await check('Related products show six, same category first, no self/duplicates', async () => {
    const page = await pageFor('/product-details.html?id=mto');
    await page.locator('.related-grid-inner .product-card').first().waitFor();
    assert.equal(await page.locator('.related-grid-inner .product-card').count(), 6);
    const texts = await page.locator('.related-grid-inner .product-card').allTextContents();
    assert.equal(new Set(texts).size, 6); assert.ok(!texts.some(t => t.includes('Test mto')));
    assert.ok(texts[0].includes('Test standard'));
    await page.screenshot({ path: path.join(fixture, 'product-desktop.png'), fullPage: true });
    await page.context().close();
  });
  await check('Home quick add -> checkout saves MTO order', async () => {
    const page = await pageFor('/');
    await page.locator('.js-add-card[data-id="mto"]').click();
    assert.equal((await page.evaluate(() => MBStore.getCart()))[0].product._inventoryMode, 'made-to-order');
    await checkout(page); await submit(page); await page.waitForURL('**/success.html?**');
    assert.ok(read('orders').some(o => o.orderNumber === new URL(page.url()).searchParams.get('orderNumber')));
    await page.context().close();
  });
  await check('Mobile sticky Buy now -> MTO card checkout without receipt', async () => {
    const page = await pageFor('/product-details.html?id=mto', true);
    await page.locator('#stickyBuyNowBtn').waitFor();
    assert.equal(await page.locator('.pd-sku-code').isVisible(), true);
    const stickyBox = await page.locator('#pdStickyBar').boundingBox();
    const navBox = await page.locator('#mb-bottom-nav').boundingBox();
    assert.ok(stickyBox && navBox && stickyBox.y + stickyBox.height <= navBox.y + 1, 'product actions must sit above mobile navigation');
    await page.screenshot({ path: path.join(fixture, 'product-mobile.png'), fullPage: true });
    await page.locator('#stickyBuyNowBtn').click();
    await page.waitForURL('**/checkout.html');
    await checkout(page);
    await page.locator('input[name="paymentType"][value="karta"]').check();
    assert.equal(await page.locator('#paymentScreenshotWrap').isVisible(), false);
    await submit(page); await page.waitForURL('**/success.html?**');
    const orderNumber = new URL(page.url()).searchParams.get('orderNumber');
    let order = read('orders').find(o => o.orderNumber === orderNumber);
    const orderId = order.id;
    assert.equal(order.status, 'pending_confirmation'); assert.equal(order.paymentStatus, 'pending'); assert.equal(order.paymentType, 'karta');

    // An unpaid order cannot enter production. Confirmation leaves payment
    // pending; an admin cannot impersonate the online payment provider.
    await page.goto(base + '/admin.html'); await login(page);
    const adminPatch = (endpoint, body = {}) => page.evaluate(async ({ orderId, endpoint, body }) => {
      const response = await fetch('/api/orders/' + encodeURIComponent(orderId) + '/' + endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('mb_admin_token') },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    }, { orderId, endpoint, body });
    let response = await adminPatch('confirm');
    assert.equal(response.status, 200); assert.equal(response.data.order.status, 'confirmed'); assert.equal(response.data.order.paymentStatus, 'pending');
    response = await adminPatch('status', { status: 'production' });
    assert.equal(response.status, 409);
    order = read('orders').find(o => o.id === orderId);
    assert.equal(order.status, 'confirmed'); assert.equal(order.paymentStatus, 'pending');
    response = await adminPatch('payment');
    assert.equal(response.status, 409); assert.equal(response.data.code, 'PROVIDER_VERIFICATION_REQUIRED');
    order = read('orders').find(o => o.id === orderId);
    assert.equal(order.status, 'confirmed'); assert.equal(order.paymentStatus, 'pending'); assert.ok(!order.paymentCollectedAt);
    await page.context().close();
  });
  await check('Mobile standard unpaid order starts payment-pending and authenticated collection starts production', async () => {
    const page = await pageFor('/product-details.html?id=standard-mobile', true);
    await page.locator('#stickyBuyNowBtn').click(); await page.waitForURL('**/checkout.html');
    await checkout(page); await submit(page); await page.waitForURL('**/success.html?**');
    const orderNumber = new URL(page.url()).searchParams.get('orderNumber');
    let order = read('orders').find(o => o.orderNumber === orderNumber);
    const orderId = order.id;
    assert.equal(order.status, 'payment_pending'); assert.equal(order.paymentStatus, 'pending');
    await page.goto(base + '/admin.html'); await login(page);
    const result = await page.evaluate(async orderId => {
      const response = await fetch('/api/orders/' + encodeURIComponent(orderId) + '/payment', {
        method: 'PATCH', headers: { Authorization: 'Bearer ' + localStorage.getItem('mb_admin_token') },
      });
      return { status: response.status, data: await response.json() };
    }, orderId);
    assert.equal(result.status, 200); assert.equal(result.data.order.status, 'production'); assert.equal(result.data.order.paymentStatus, 'collected');
    await page.context().close();
  });
  await check('Admin order search, combined filters, pagination, timeline and responsive layout', async () => {
    const existing = read('orders');
    const seeded = Array.from({ length: 27 }, (_, index) => {
      const createdAt = new Date(Date.UTC(2026, 1, index + 1, 10, 0, 0)).toISOString();
      const status = index % 2 ? 'shipped' : 'production';
      return {
        id: 'browser-admin-' + index, orderNumber: 'DOD-ORD-' + (9001 + index),
        name: index === 12 ? 'Maxsus Mijoz' : 'Sinov Mijoz ' + index,
        phone: '+998 90 555 ' + String(index).padStart(4, '0'), address: 'Alohida sinov manzili', note: '',
        items: [{ productId: 'mto', sku: 'DOD-0001', name: 'Test mto', qty: 1, price: 100000, size: 'Standart', color: 'Oq' }],
        subtotal: (index + 1) * 100000, discountAmount: 0, total: (index + 1) * 100000,
        paymentType: 'naqd', paymentStatus: 'collected', paymentScreenshot: '', status, createdAt,
        updatedAt: new Date(Date.parse(createdAt) + index * 60000).toISOString(),
        statusHistory: [{ status, changedBy: 'isolated-admin', changedAt: createdAt, reason: 'Status updated by admin' }],
      };
    });
    write('orders', existing.concat(seeded));

    const page = await pageFor('/admin.html'); await login(page);
    await page.locator('#menuOrders').click();
    await page.locator('#ordersPagination:not(.hidden)').waitFor();
    assert.match(await page.locator('#ordersPageInfo').innerText(), /1 \/ 3-sahifa|1 \/ 4-sahifa/);
    assert.equal(await page.locator('.order-item').count(), 10);
    await page.locator('#ordersNext').click();
    await page.waitForFunction(() => document.querySelector('#ordersPageInfo').textContent.startsWith('2 /'));

    await page.locator('#orderSearch').fill('MAXSUS mijoz');
    await page.waitForFunction(() => document.querySelector('#ordersMatchCount').textContent.trim() === 'Mos buyurtmalar: 1 ta');
    assert.equal(await page.locator('.order-item').count(), 1);
    await page.locator('#orderStatusFilter').selectOption('production');
    await page.waitForFunction(() => document.querySelector('#ordersMatchCount').textContent.trim() === 'Mos buyurtmalar: 1 ta');
    await page.locator('.js-order-detail').click();
    await page.locator('#orderDetailOverlay:not(.hidden)').waitFor();
    const detailText = await page.locator('#orderDetailContent').innerText();
    assert.match(detailText, /DOD-ORD-9013/); assert.match(detailText, /SKU: DOD-0001/);
    assert.match(detailText, /Holat tarixi/i); assert.match(detailText, /Administrator tomonidan yangilandi|Holat administrator tomonidan yangilandi/i);
    assert.doesNotMatch(detailText, /pending_confirmation|payment_pending|production|shipped|delivered/);
    await page.screenshot({ path: path.join(fixture, 'admin-orders-desktop.png'), fullPage: true });
    await page.context().close();

    const mobile = await pageFor('/admin.html', true); await login(mobile);
    await mobile.locator('#menuOrders').click();
    await mobile.locator('#orderSearch').fill('DOD-ORD-9013');
    await mobile.waitForFunction(() => document.querySelector('#ordersMatchCount').textContent.trim() === 'Mos buyurtmalar: 1 ta');
    assert.equal(await mobile.locator('.order-compact-row').count(), 1);
    await mobile.locator('.order-compact-row').click();
    await mobile.locator('#orderDetailOverlay:not(.hidden)').waitFor();
    assert.match(await mobile.locator('#orderDetailContent').innerText(), /SKU: DOD-0001/);
    const toolbarBox = await mobile.locator('.order-management-toolbar').boundingBox();
    assert.ok(toolbarBox && toolbarBox.width <= 390);
    await mobile.screenshot({ path: path.join(fixture, 'admin-orders-mobile.png'), fullPage: true });
    await mobile.context().close();
  });
  await check('Standard stock, existing cart totals and invalid quantities stay restricted', async () => {
    const page = await pageFor('/product-details.html?id=standard');
    await page.locator('#qtyInput').fill('3'); await page.locator('#addToCartBtn').click();
    await page.locator('#qtyInput').fill('1'); await page.locator('#addToCartBtn').click();
    assert.match(await page.locator('#pdMessage').innerText(), /Omborda/);
    assert.equal((await page.evaluate(() => MBStore.getCart()))[0].qty, 3);
    for (const qty of ['0', '-1', '1.5', '1000']) {
      await page.locator('#qtyInput').fill(qty); await page.locator('#addToCartBtn').click();
      assert.equal((await page.evaluate(() => MBStore.getCart()))[0].qty, 3);
    }
    await page.goto(base + '/product-details.html?id=soldout');
    await page.locator('#addToCartBtn').waitFor(); assert.equal(await page.locator('#addToCartBtn').isDisabled(), true);
    await page.context().close();
  });
  await check('Size ranges and complete multiword/hyphen colors reach server unchanged', async () => {
    const page = await pageFor('/product-details.html?id=range');
    await page.locator('.pd-chip[data-group="size"]').filter({ hasText: /^\s*XL\s*$/ }).click();
    await page.locator('.pd-chip[data-group="color"]').filter({ hasText: 'Qora-oq' }).click();
    await page.locator('#buyNowBtn').click(); await page.waitForURL('**/checkout.html');
    await checkout(page); await submit(page); await page.waitForURL('**/success.html?**');
    const order = read('orders').find(o => o.orderNumber === new URL(page.url()).searchParams.get('orderNumber'));
    assert.equal(order.items[0].size, 'XL'); assert.equal(order.items[0].color, 'Qora-oq');
    assert.equal(read('products').find(p => p.id === 'range').stock, 9);
    await page.context().close();
  });
  for (const failure of ['validation', 'server', 'network']) await check('Checkout ' + failure + ' error retains cart and allows retry', async () => {
    const page = await pageFor('/product-details.html?id=mto');
    await page.locator('#addToCartBtn').click(); await checkout(page);
    const before = read('orders').length;
    await page.route('**/api/orders', route => failure === 'network' ? route.abort() : route.fulfill({
      status: failure === 'validation' ? 400 : 500, contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic ' + failure + ' failure' }) }));
    await submit(page); await page.locator('.checkout-msg--error').waitFor();
    assert.ok(page.url().includes('/checkout.html'));
    assert.equal((await page.evaluate(() => MBStore.getCart())).length, 1);
    assert.equal(read('orders').length, before);
    assert.equal(await page.getByRole('button', { name: 'Buyurtma berish', exact: true }).isDisabled(), false);
    await page.unroute('**/api/orders'); await submit(page); await page.waitForURL('**/success.html?**');
    assert.equal(read('orders').length, before + 1);
    await page.context().close();
  });
  await check('Admin refuses legacy fallback credentials and cached fake session', async () => {
    const page = await pageFor('/admin.html');
    await page.locator('#username').fill('admin'); await page.locator('#password').fill('12345678');
    await page.locator('#loginBtn').click(); await page.locator('#loginMessage').filter({ hasText: "noto'g'ri" }).waitFor();
    assert.equal(await page.locator('#adminApp').isVisible(), false);
    await page.evaluate(() => { localStorage.setItem('mb_admin_token', 'fallback-admin-token'); localStorage.setItem('mb_admin_logged_in', 'true'); });
    await page.reload(); assert.equal(await page.locator('#adminApp').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('mb_admin_token')), null);
    await page.context().close();
  });
  await check('Real admin login lists saved checkout orders; reload and API errors are honest', async () => {
    const page = await pageFor('/admin.html'); await login(page);
    await page.evaluate(() => showSection('products'));
    await page.locator('#productSearch').fill('DOD-0001');
    await page.locator('#productsList .product-card').first().waitFor();
    assert.equal(await page.locator('#productsList .product-card').count(), 1);
    assert.match(await page.locator('#productsList').innerText(), /SKU: DOD-0001/);
    await page.locator('#menuOrders').click();
    await page.locator('#ordersList').filter({ hasText: 'Synthetic Browser Customer' }).waitFor();
    assert.ok((await page.locator('#ordersList').innerText()).includes(read('orders')[0].orderNumber));
    await page.screenshot({ path: path.join(fixture, 'admin-orders-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
    await page.locator('#adminApp').waitFor({ state: 'visible' });
    // Use the same section action on mobile where the sidebar is collapsed.
    await page.evaluate(() => showSection('orders'));
    await page.locator('#ordersList').filter({ hasText: 'Synthetic Browser Customer' }).waitFor();
    await page.screenshot({ path: path.join(fixture, 'admin-orders-mobile.png'), fullPage: true });
    await page.route('**/api/orders?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Synthetic outage"}' }));
    await page.evaluate(() => loadOrders());
    assert.match(await page.locator('#ordersList').innerText(), /yuklab bo'lmad/i);
    assert.ok(!(await page.locator('#ordersList').innerText()).includes("Hozircha buyurtmalar yo'q"));
    await page.unroute('**/api/orders?**');
    await page.evaluate(() => localStorage.setItem('mb_admin_token', 'expired-test-token'));
    await page.reload(); await page.locator('#loginMessage').filter({ hasText: 'Sessiya' }).waitFor();
    assert.equal(await page.locator('#adminApp').isVisible(), false);
    await page.context().close();
  });
  await check('Admin warehouse management works on desktop and mobile with low-stock warning', async () => {
    const page = await pageFor('/admin.html'); await login(page);
    await page.evaluate(() => showSection('products'));
    await page.locator('#productSearch').fill('warehouse');
    const card = page.locator('#productsList .product-card').filter({ hasText: 'Test warehouse' });
    await card.getByRole('button', { name: 'Ombor', exact: true }).click();
    await page.locator('#stockOverlay:not(.hidden)').waitFor();
    await page.locator('#stockSummary').filter({ hasText: '6 ta' }).waitFor();
    assert.match(await page.locator('#stockSummary').innerText(), /Mavjud\s+6 ta/);
    await page.locator('#stockChange').fill('-1');
    await page.locator('#stockReason').fill("Brauzer sinovidagi ombor sanog'i");
    await page.locator('#stockAdjustmentForm').getByRole('button', { name: 'Saqlash' }).click();
    await page.locator('#stockSummary').filter({ hasText: '5 ta' }).waitFor();
    assert.match(await page.locator('#stockHistoryList').innerText(), /Admin tomonidan o'zgartirildi/);
    await page.screenshot({ path: path.join(fixture, 'admin-stock-desktop.png'), fullPage: true });
    await page.locator('#stockOverlay .odm-close').click();
    assert.match(await card.innerText(), /Ombor: 5 ta · Kam qoldi/);
    await page.setViewportSize({ width: 390, height: 844 });
    await card.getByRole('button', { name: 'Ombor', exact: true }).click();
    await page.locator('#stockOverlay:not(.hidden)').waitFor();
    const drawerBox = await page.locator('.stock-drawer').boundingBox();
    assert.ok(drawerBox && drawerBox.width <= 390);
    await page.screenshot({ path: path.join(fixture, 'admin-stock-mobile.png'), fullPage: true });
    assert.equal(read('products').find(item => item.id === 'warehouse').available, 5);
    await page.context().close();
  });
  await check('Protected files and unauthenticated admin orders stay blocked', async () => {
    for (const url of ['/data/products.json', '/data/orders.json', '/server.js', '/.env']) assert.equal((await fetch(base + url)).status, 404);
    assert.equal((await fetch(base + '/api/orders')).status, 401);
  });
  await check('Optional carousel plugin still initializes when its library is present', async () => {
    const page = await pageFor('/blog.html');
    const state = await page.evaluate(() => {
      const host = document.createElement('div');
      host.className = 'isolated-carousel-check';
      host.innerHTML = '<div>One</div><div>Two</div>';
      document.body.appendChild(host);
      const available = Boolean(window.jQuery && jQuery.fn.owlCarousel);
      if (available) jQuery(host).owlCarousel({ items: 1 });
      return { available, initialized: host.classList.contains('owl-loaded') };
    });
    assert.deepEqual(state, { available: true, initialized: true });
    await page.context().close();
  });
  await check('No uncaught browser JavaScript errors', async () => assert.deepEqual(errors, []));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(fixture, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, fixture }));
  if (results.some(r => !r.passed)) process.exitCode = 1;
});
