// Run explicitly: node --test test/security-correctness.test.cjs
// Synthetic fixtures remain under .local-tests; this suite never opens .env or production JSON.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-test-secret-never-used-in-production';
process.env.ADMIN_USERNAME = 'isolated-admin';
process.env.ADMIN_PASSWORD = 'isolated-password';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
const { createApp } = require('../server');
const schema = require('../js/order-schema');
const { submitOrder } = require('../js/order-submit');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, '.local-tests', crypto.randomUUID());
const dataDir = path.join(fixture, 'data');
const uploadsDir = path.join(fixture, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
const dataPath = name => path.join(dataDir, name + '.json');
const read = name => JSON.parse(fs.readFileSync(dataPath(name), 'utf8'));
const write = (name, value) => fs.writeFileSync(dataPath(name), JSON.stringify(value));
const admin = jwt.sign({ username: 'isolated-admin', role: 'admin' }, process.env.JWT_SECRET);
const customer = jwt.sign({ username: 'customer', role: 'customer' }, process.env.JWT_SECRET);
const product = (id, stock, mode = 'standard') => ({ id, name: id, category: 'Test', desc: 'Synthetic fixture',
  price: 100, stock, _inventoryMode: mode, _productionDays: 14, _acceptsMTO: mode === 'made-to-order',
  image: 'uploads/product.png', images: ['uploads/product.png'], colors: 'Red,Blue', sizes: 'M,L', sourceName: 'Test source' });
const payload = items => ({ name: 'Synthetic customer', phone: '+998900000000', address: 'Isolated test address', items });
const item = (productId, qty, color = 'Red') => ({ productId, qty, color, size: 'M' });
let app;
beforeEach(() => {
  write('products', [product('standard', 5), product('mto', 0, 'made-to-order'), product('large', 1000)]);
  write('orders', []); write('categories', ['Test']); write('promocodes', []); write('reviews', []);
  fs.writeFileSync(path.join(uploadsDir, 'product.png'), 'synthetic image');
  fs.writeFileSync(path.join(uploadsDir, 'receipt.png'), 'synthetic private receipt');
  app = createApp({ dataDir, uploadsDir, notifyOrder: async () => {} });
});
const patch = (id, action, body = {}) => request(app).patch('/api/orders/' + id + '/' + action).set('Authorization', 'Bearer ' + admin).send(body);
async function create(items = [item('mto', 1)], extra = {}) {
  const result = await request(app).post('/api/orders').send({ ...payload(items), ...extra }).expect(201);
  return result.body.order;
}

test('isolated admin credentials issue a JWT accepted by protected middleware', async () => {
  const login = await request(app).post('/api/admin/login').send({
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  }).expect(200);
  assert.equal(login.body.success, true);
  assert.equal(typeof login.body.token, 'string');
  await request(app).get('/api/orders').set('Authorization', 'Bearer ' + login.body.token).expect(200);
});

test('incorrect isolated admin password is rejected without a token', async () => {
  const login = await request(app).post('/api/admin/login').send({
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD + '-incorrect',
  }).expect(401);
  assert.equal(login.body.success, false);
  assert.equal(login.body.token, undefined);
});

test('import requires isolated directories', () => {
  assert.throws(() => createApp(), /isolated/);
  assert.throws(() => createApp({ dataDir: path.join(root, 'data'), uploadsDir }), /isolated/);
});
for (const url of ['/data/products.json', '/data/orders.json', '/data/promocodes.json',
  '/data/backups/orders-before-schema-extension-1791535767377.json', '/.env', '/%2eenv', '/.git/config',
  '/server.js', '/package.json', '/package-lock.json', '/utils/jsonStore.js', '/middleware/verifyAdminToken.js',
  '/scripts/migrate-to-mto.js', '/test/security-correctness.test.cjs', '/js/order-schema.js',
  '/js/order-schema.js.map', '/uploads/buyo/gallery-manifest.json', '/.kiro/specs/made-to-order-upgrade/tasks.md',
  '/.local-backups/security-correctness-2026-10-09T16-27-04-805Z/server.js',
  '/uploads/%2e%2e/server.js', '/img/%2e%2e/server.js', '/js/..%5cserver.js', '/uploads/receipt.png']) {
  test('private path blocked: ' + url, async () => { await request(app).get(url).expect(404); });
}
for (const url of ['/', '/shop.html', '/checkout.html', '/admin.html', '/js/store.js', '/js/order-submit.js', '/js/order-labels.js', '/css/style.css', '/uploads/product.png']) {
  test('public storefront asset available: ' + url, async () => { await request(app).get(url).expect(200); });
}
test('HEAD cannot expose server source', async () => { await request(app).head('/server.js').expect(404); });
test('new MTO order is pending confirmation with matching history', async () => {
  const order = await create(); const saved = read('orders')[0];
  assert.equal(order.status, 'pending_confirmation');
  assert.equal(saved.statusHistory[0].status, saved.status);
  assert.equal(read('products')[1].stock, 0);
});
test('standard orders wait for payment and deduct stock', async () => {
  const order = await create([item('standard', 2)]);
  assert.equal(order.status, 'payment_pending'); assert.equal(read('products')[0].stock, 3);
});
test('duplicate variant lines exceeding aggregate stock are rejected without writes', async () => {
  await request(app).post('/api/orders').send(payload([item('standard', 4), item('standard', 4, 'Blue')])).expect(400);
  assert.equal(read('orders').length, 0); assert.equal(read('products')[0].stock, 5);
});
test('duplicate lines deduct their full combined quantity', async () => {
  await create([item('standard', 2), item('standard', 3, 'Blue')]); assert.equal(read('products')[0].stock, 0);
});
test('finite inventory of 999 or more is still deducted', async () => {
  await create([item('large', 2)]); assert.equal(read('products')[2].stock, 998);
});
for (const qty of [0, -1, 1.5, 'invalid', 1000]) {
  test('invalid quantity rejected: ' + qty, async () => {
    await request(app).post('/api/orders').send(payload([item('standard', qty)])).expect(400);
    assert.equal(read('orders').length, 0);
  });
}
test('variant values must match complete names, not substrings', async () => {
  await request(app).post('/api/orders').send(payload([item('standard', 1, 'Re')])).expect(400);
});

test('numeric and letter size ranges accept only contained sizes', async () => {
  const products = read('products'); products[0].sizes = 'M-3XL'; products[1].sizes = '40-44'; write('products', products);
  await create([{ ...item('standard', 1), size: 'XL' }]);
  await create([{ ...item('mto', 1), size: '42' }]);
  await request(app).post('/api/orders').send(payload([{ ...item('mto', 1), size: '45' }])).expect(400);
});

test('complete multiword and hyphenated variants survive frontend normalization and server validation', async () => {
  const products = read('products'); products[1].colors = "To'q ko'k, Qora-oq"; products[1].sizes = ['180 x 65 cm']; write('products', products);
  const rules = require('../js/product-rules');
  assert.deepEqual(rules.options(products[1].colors, 'color'), ["To'q ko'k", 'Qora-oq']);
  assert.deepEqual(rules.options(products[1].sizes, 'size'), ['180 x 65 cm']);
  await create([{ ...item('mto', 1, "To'q ko'k"), size: '180 x 65 cm' }]);
  await request(app).post('/api/orders').send(payload([{ ...item('mto', 1, "To'q"), size: '180 x 65 cm' }])).expect(400);
});

test('cart rules aggregate standard stock across variants but allow zero-stock MTO', () => {
  const rules = require('../js/product-rules');
  assert.ok(rules.additionError(product('standard', 3), 2, [item('standard', 2, 'Blue')]));
  assert.equal(rules.additionError(product('mto', 0, 'made-to-order'), 999, []), '');
  for (const qty of [0, -1, 1.5, NaN, 1000]) assert.ok(rules.additionError(product('mto', 0, 'made-to-order'), qty, []));
});
test('MTO quantity 999 succeeds with zero stock', async () => { await create([item('mto', 999)]); });
test('idempotent retry remains deduplicated after creating a fresh app', async () => {
  const submissionToken = crypto.randomUUID(); const first = await create([item('standard', 2)], { submissionToken });
  app = createApp({ dataDir, uploadsDir, notifyOrder: async () => {} });
  const second = await create([item('standard', 2)], { submissionToken });
  assert.equal(first.id, second.id); assert.equal(read('orders').length, 1); assert.equal(read('products')[0].stock, 3);
});
test('MTO product edit preserves mode, images and imported metadata', async () => {
  const result = await request(app).put('/api/products/mto').set('Authorization', 'Bearer ' + admin).send({ price: 200 }).expect(200);
  assert.equal(result.body.product._inventoryMode, 'made-to-order');
  assert.equal(result.body.product.sourceName, 'Test source');
  assert.deepEqual(result.body.product.images, ['uploads/product.png']);
});
test('explicit inventory mode changes work; invalid edits do not persist', async () => {
  await request(app).put('/api/products/mto').set('Authorization', 'Bearer ' + admin).send({ inventoryMode: 'standard' }).expect(200);
  assert.equal(read('products')[1]._inventoryMode, 'standard');
  await request(app).put('/api/products/mto').set('Authorization', 'Bearer ' + admin).send({ inventoryMode: 'invalid' }).expect(400);
  assert.equal(read('products')[1]._inventoryMode, 'standard');
});
test('admin confirmation uses authenticated identity and renews payment deadline', async () => {
  const order = await create();
  const result = await patch(order.id, 'confirm', { adjustmentReason: 'Ready to make' }).expect(200);
  assert.equal(result.body.order.status, 'confirmed');
  const saved = read('orders')[0];
  assert.equal(saved.statusHistory.at(-1).changedBy, 'isolated-admin');
  assert.equal(saved.statusHistory.at(-1).reason, 'Ready to make');
  assert.ok(Date.parse(saved.paymentDeadline) > Date.now() + 6 * 86400000);
  await patch(order.id, 'confirm').expect(409);
});
for (const action of ['confirm', 'reject', 'status', 'payment']) {
  test('admin authorization required for ' + action, async () => {
    const order = await create();
    await request(app).patch('/api/orders/' + order.id + '/' + action).send({ status: 'confirmed', reason: 'Test' }).expect(401);
    await request(app).patch('/api/orders/' + order.id + '/' + action).set('Authorization', 'Bearer ' + customer).send({}).expect(403);
  });
}
test('mixed order rejection restores all reserved stock exactly once', async () => {
  const order = await create([item('mto', 2), item('standard', 2), item('standard', 3, 'Blue')]);
  await patch(order.id, 'reject', { reason: 'Unavailable' }).expect(200);
  assert.equal(read('products')[0].stock, 5); assert.equal(read('products')[1].stock, 0);
  await patch(order.id, 'reject', { reason: 'Again' }).expect(409);
  assert.equal(read('products')[0].stock, 5);
});
test('cancellation restores reservations, including finite stock above 999', async () => {
  const order = await create([item('large', 2)]);
  await patch(order.id, 'status', { status: 'cancelled' }).expect(200);
  await patch(order.id, 'status', { status: 'cancelled' }).expect(200);
  assert.equal(read('products')[2].stock, 1000);
  assert.equal(read('orders')[0].statusHistory.length, 2);
});
test('status endpoint cannot bypass confirmation or payment', async () => {
  const order = await create();
  await patch(order.id, 'status', { status: 'shipped' }).expect(409);
  await patch(order.id, 'payment').expect(409);
  await patch(order.id, 'status', { status: 'confirmed' }).expect(200);
  await patch(order.id, 'status', { status: 'payment_pending' }).expect(200);
  await patch(order.id, 'status', { status: 'production' }).expect(409);
  assert.equal(read('orders')[0].status, 'payment_pending');
});
test('valid lifecycle records every transition and blocks terminal-state changes', async () => {
  const order = await create();
  await patch(order.id, 'confirm').expect(200);
  await patch(order.id, 'payment').expect(200);
  await patch(order.id, 'payment').expect(409);
  await patch(order.id, 'status', { status: 'shipped', reason: 'Dispatched' }).expect(200);
  await patch(order.id, 'status', { status: 'delivered' }).expect(200);
  await patch(order.id, 'status', { status: 'confirmed' }).expect(409);
  const saved = read('orders')[0];
  assert.equal(saved.paymentStatus, 'collected');
  assert.deepEqual(saved.statusHistory.map(x => x.status), ['pending_confirmation', 'confirmed', 'production', 'shipped', 'delivered']);
  assert.ok(saved.statusHistory.slice(1).every(x => x.changedBy === 'isolated-admin'));
});
test('malformed and missing rejection reasons rejected without state changes', async () => {
  const order = await create();
  for (const reason of ['', {}, 12, 'x'.repeat(501)]) await patch(order.id, 'reject', { reason }).expect(400);
  assert.equal(read('orders')[0].status, 'pending_confirmation');
});
test('tracking and admin responses retain extended statuses and history', async () => {
  const order = await create();
  const tracked = await request(app).get('/api/orders/track').query({ orderNumber: order.orderNumber }).expect(200);
  assert.equal(tracked.body.status, 'pending_confirmation'); assert.ok(tracked.body.paymentDeadline);
  assert.equal(tracked.body.orderNumber, order.orderNumber);
  for (const privateField of ['name', 'phone', 'address', 'items', 'total', 'paymentType', 'statusHistory']) {
    assert.equal(Object.hasOwn(tracked.body, privateField), false);
  }
  const listed = await request(app).get('/api/orders').set('Authorization', 'Bearer ' + admin).expect(200);
  assert.ok(listed.body[0].allowedNextStatuses.includes('confirmed'));
});
test('receipt access is authenticated and not available from uploads', async () => {
  const order = await create(); const orders = read('orders'); orders[0].paymentScreenshot = 'uploads/receipt.png'; write('orders', orders);
  await request(app).get('/uploads/receipt.png').expect(404);
  await request(app).get('/api/orders/' + order.id + '/receipt').expect(401);
  await request(app).get('/api/orders/' + order.id + '/receipt').set('Authorization', 'Bearer ' + admin).expect(200);
});
test('failed order write rolls back stock and does not report success', async () => {
  const original = fs.writeFileSync;
  fs.writeFileSync = function (file, ...args) {
    if (String(file) === dataPath('orders') + '.tmp') throw new Error('Injected isolated storage failure');
    return original.call(fs, file, ...args);
  };
  try { await request(app).post('/api/orders').send(payload([item('standard', 2)])).expect(500); }
  finally { fs.writeFileSync = original; }
  assert.equal(read('orders').length, 0); assert.equal(read('products')[0].stock, 5);
});
test('schema transitions do not mutate the previous audit history', () => {
  const original = schema.initializeOrderWithExtendedSchema({ id: 'synthetic', items: [] }, true);
  const confirmed = schema.confirmOrder(original, 'Ready', 'admin');
  assert.equal(original.statusHistory.length, 1); assert.equal(confirmed.order.statusHistory.length, 2);
});

const responses = [
  ['validation failure', async () => ({ ok: false, json: async () => ({ error: 'Validation failed', errors: [{ message: 'Insufficient stock' }] }) }), false],
  ['server failure', async () => ({ ok: false, json: async () => ({ error: 'Internal server error' }) }), false],
  ['missing API', async () => ({ ok: false, json: async () => ({}) }), false],
  ['network failure', async () => { throw new Error('offline'); }, false],
  ['invalid JSON', async () => ({ ok: true, json: async () => { throw new Error('html'); } }), false],
  ['missing acknowledgement', async () => ({ ok: true, json: async () => ({ success: true }) }), false],
  ['explicit rejection', async () => ({ ok: true, json: async () => ({ success: false, order: { id: 'not-saved' } }) }), false],
  ['saved order', async () => ({ ok: true, json: async () => ({ success: true, order: { id: 'saved-order', total: 100 } }) }), true]
];
function extract(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'test anchors exist'); return source.slice(a, b);
}
for (const [name, fetcher, success] of responses) {
  test('actual checkout handler preserves cart unless acknowledged: ' + name, async () => {
    const html = fs.readFileSync(path.join(root, 'checkout.html'), 'utf8');
    const source = extract(html, '    function completeOrder(', '    async function applyPromoCode(') + extract(html, '    async function submitOrder()', "    document.querySelectorAll('input[name=");
    let cleared = 0; let message = '';
    const button = { disabled: false, textContent: 'Submit', classList: { add() {}, remove() {} } };
    const elements = { name: { value: 'Synthetic' }, phone: { value: '+998900000000' }, address: { value: 'Synthetic address' }, note: { value: '' }, paymentScreenshot: { files: [] } };
    const context = { document: { getElementById: id => elements[id], querySelector: () => button }, window: { location: { href: 'checkout.html' } },
      MBStore: { clearCart: () => cleared++ }, MBOrderSubmit: { submitOrder: options => submitOrder(options, fetcher), submissionToken: () => 'isolated-submission-token', forgetSubmissionToken() {} },
      checkoutItems: [item('standard', 1)], checkoutTotal: 100, checkoutSubtotal: 100, appliedPromo: null,
      getSelectedPaymentType: () => 'naqd', hasMadeToOrderItems: () => false, clearFieldErrors() {}, setFieldError() {}, setCheckoutMessage: text => { message = text; } };
    vm.createContext(context); vm.runInContext(source, context); await context.submitOrder();
    assert.equal(cleared, success ? 1 : 0); assert.equal(button.disabled, false);
    assert.equal(context.window.location.href.startsWith('success.html'), success); assert.ok(message);
  });
  test('Kiro checkout handler preserves cart unless acknowledged: ' + name, async () => {
    const script = fs.readFileSync(path.join(root, 'js/checkout-page.js'), 'utf8');
    const source = extract(script, "  form.addEventListener('submit',", '\n  });') + '\n  });';
    let handler; let cleared = 0;
    const button = { disabled: false };
    const form = { dataset: {}, querySelector: () => button, reset() {}, addEventListener: (_, fn) => { handler = fn; } };
    const context = { form, msg: { style: {} }, summary: {}, window: { location: { href: 'checkout.html' } },
      items: [{ ...item('standard', 1), product: product('standard', 5) }], total: 100,
      validateProductStock: async () => ({ valid: true }), FormData: class { entries() { return Object.entries(payload([])); } },
      MBStore: { clearCart: () => cleared++ }, MBOrderSubmit: { submitOrder: options => submitOrder(options, fetcher), submissionToken: () => 'isolated-submission-token', forgetSubmissionToken() {} } };
    vm.createContext(context); vm.runInContext(source, context); await handler({ preventDefault() {} });
    assert.equal(cleared, success ? 1 : 0); assert.equal(button.disabled, false);
    assert.equal(context.window.location.href.startsWith('success.html'), success); assert.ok(context.msg.textContent);
  });
}
test('zero-stock catalog products remain zero; MTO cards remain purchasable', () => {
  const context = { window: { MBProductRules: require('../js/product-rules') }, document: {} };
  vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'js/helpers.js'), 'utf8'), context);
  const helpers = context.window.MBHelpers;
  assert.equal(helpers.normalizeProduct(product('zero', 0)).stock, 0);
  assert.ok(!helpers.productCard(product('zero', 0)).includes('js-add-card'));
  assert.ok(helpers.productCard(product('mto', 0, 'made-to-order')).includes('js-add-card'));
});
test('legacy new order confirmation adds audit history without a migration', async () => {
  write('orders', [{ ...payload([item('mto', 1)]), id: 'legacy-test', status: 'new', createdAt: new Date().toISOString() }]);
  await patch('legacy-test', 'confirm').expect(200);
  const order = read('orders')[0];
  assert.deepEqual(order.statusHistory.map(x => x.status), ['new', 'confirmed']);
  assert.equal(order.statusHistory[1].changedBy, 'isolated-admin');
});
test('receipt path cannot traverse outside uploads', async () => {
  const order = await create(); const orders = read('orders'); orders[0].paymentScreenshot = 'uploads/../data/orders.json'; write('orders', orders);
  await request(app).get('/api/orders/' + order.id + '/receipt').set('Authorization', 'Bearer ' + admin).expect(404);
});
test('admin status handler waits for API success before changing local state', async () => {
  const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  const source = extract(html, '    async function saveOrderStatus(', '    // ========== ORDER DETAIL MODAL');
  const select = { value: 'confirmed', disabled: false }; let writes = 0; let notice = '';
  const context = { document: { getElementById: () => select }, cachedOrders: [{ id: 'test', status: 'pending_confirmation' }],
    requestJson: async () => { throw new Error('API rejected change'); }, writeLocalArray: () => writes++, showNotice: message => { notice = message; } };
  vm.createContext(context); vm.runInContext(source, context);
  assert.equal(await context.saveOrderStatus('test', 'select'), false);
  assert.equal(context.cachedOrders[0].status, 'pending_confirmation'); assert.equal(writes, 0); assert.equal(select.disabled, false);
  assert.equal(notice, 'API rejected change');
});
test('all changed source and inline scripts parse', () => {
  for (const file of ['server.js', 'utils/publicFiles.js', 'js/order-schema.js', 'js/order-submit.js', 'js/checkout-page.js', 'js/helpers.js']) {
    new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  }
  for (const file of ['checkout.html', 'admin.html', 'track-order.html']) {
    for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) new vm.Script(match[1], { filename: file });
    }
  }
});
