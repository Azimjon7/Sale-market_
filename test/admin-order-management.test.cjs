// Run explicitly: node --test test/admin-order-management.test.cjs
// Uses only synthetic files under .local-tests and never reads production JSON or .env.
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-admin-orders-secret-with-32-characters';
process.env.ADMIN_USERNAME = 'isolated-admin';
process.env.ADMIN_PASSWORD = 'isolated-password';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

const { createApp } = require('../server');
const labels = require('../js/order-labels');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, '.local-tests', crypto.randomUUID());
const dataDir = path.join(fixture, 'data');
const uploadsDir = path.join(fixture, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(dataDir, name + '.json'), JSON.stringify(value));
const read = name => JSON.parse(fs.readFileSync(path.join(dataDir, name + '.json'), 'utf8'));
const adminToken = jwt.sign({ username: 'isolated-admin', role: 'admin' }, process.env.JWT_SECRET);
const auth = req => req.set('Authorization', 'Bearer ' + adminToken);

const statuses = ['pending_confirmation', 'payment_pending', 'confirmed', 'production', 'shipped', 'delivered', 'rejected', 'cancelled'];
function syntheticOrders() {
  return Array.from({ length: 32 }, (_, index) => {
    const number = 1001 + index;
    const createdAt = new Date(Date.UTC(2026, 0, index + 1, 10, 0, 0)).toISOString();
    const status = statuses[index % statuses.length];
    const paymentStatus = index === 4 ? 'failed' : index > 0 && index % 3 === 0 ? 'collected' : 'pending';
    return {
      id: 'internal-' + String(index + 1).padStart(2, '0'),
      orderNumber: 'DOD-ORD-' + number,
      name: index === 7 ? 'Aziza Maxsus' : 'Mijoz ' + (index + 1),
      phone: index === 9 ? '+998 90 777 66 55' : '+998 90 000 ' + String(index).padStart(4, '0'),
      address: 'Faqat sinov manzili', note: '', total: (index + 1) * 1000,
      subtotal: (index + 1) * 1000, discountAmount: 0, promoCode: '',
      items: [{ productId: 'product-1', sku: 'DOD-0001', name: 'Sinov mahsuloti', qty: 1, price: (index + 1) * 1000, size: 'M', color: 'Qora' }],
      paymentType: index === 0 ? 'karta' : 'naqd', paymentStatus,
      paymentScreenshot: '', status, createdAt, updatedAt: new Date(Date.parse(createdAt) + index * 60000).toISOString(),
      statusHistory: [{ status, changedBy: 'system', changedAt: createdAt, reason: 'Order created by customer' }],
    };
  });
}

let app;
beforeEach(() => {
  write('products', [{ id: 'product-1', sku: 'DOD-0001', name: 'Sinov mahsuloti', price: 1000, stock: 50,
    category: 'Sinov', image: 'img/placeholders/product.svg', images: ['img/placeholders/product.svg'], _inventoryMode: 'standard' }]);
  write('orders', syntheticOrders());
  write('categories', ['Sinov']); write('promocodes', []); write('reviews', []);
  app = createApp({ dataDir, uploadsDir, notifyOrder: async () => {} });
});

after(() => fs.rmSync(fixture, { recursive: true, force: true }));

test('admin order data remains protected by authentication', async () => {
  await request(app).get('/api/orders?search=Aziza').expect(401);
  const tracked = await request(app).get('/api/orders/track?orderNumber=DOD-ORD-1008').expect(200);
  for (const field of ['name', 'phone', 'address', 'items', 'total', 'statusHistory', 'id']) {
    assert.equal(Object.hasOwn(tracked.body, field), false);
  }
});

test('partial case-insensitive search covers public number, ID, name and phone', async () => {
  for (const [term, expected] of [['ord-1008', 'DOD-ORD-1008'], ['NAL-11', 'DOD-ORD-1011'], ['aziza MAX', 'DOD-ORD-1008'], ['777 66', 'DOD-ORD-1010']]) {
    const result = await auth(request(app).get('/api/orders').query({ search: term, page: 1, limit: 10 })).expect(200);
    assert.equal(result.body.meta.total, 1, term);
    assert.equal(result.body.orders[0].orderNumber, expected, term);
  }
});

test('status and payment filters combine with search and sorting', async () => {
  const pending = await auth(request(app).get('/api/orders').query({ filter: 'pending_confirmation', sort: 'oldest', page: 1, limit: 10 })).expect(200);
  assert.ok(pending.body.orders.every(order => order.status === 'pending_confirmation'));
  assert.deepEqual(pending.body.orders.map(order => order.orderNumber), [...pending.body.orders].map(order => order.orderNumber).sort());

  const paid = await auth(request(app).get('/api/orders').query({ filter: 'payment_confirmed', sort: 'total-high', page: 1, limit: 25 })).expect(200);
  assert.ok(paid.body.orders.every(order => order.paymentStatus === 'collected'));
  assert.ok(paid.body.orders.every((order, index, rows) => index === 0 || rows[index - 1].total >= order.total));

  const failed = await auth(request(app).get('/api/orders').query({ search: 'Mijoz', filter: 'payment_failed', sort: 'updated', page: 1, limit: 10 })).expect(200);
  assert.equal(failed.body.meta.total, 1);
  assert.equal(failed.body.orders[0].paymentStatus, 'failed');
});

test('pagination returns only the requested page and accurate totals', async () => {
  const page2 = await auth(request(app).get('/api/orders').query({ filter: 'all', sort: 'newest', page: 2, limit: 10 })).expect(200);
  assert.deepEqual(page2.body.meta, { total: 32, page: 2, limit: 10, pages: 4 });
  assert.equal(page2.body.orders.length, 10);
  assert.equal(page2.body.orders[0].orderNumber, 'DOD-ORD-1022');
  const twentyFive = await auth(request(app).get('/api/orders').query({ page: 2, limit: 25 })).expect(200);
  assert.equal(twentyFive.body.orders.length, 7);
  await auth(request(app).get('/api/orders').query({ page: 1, limit: 20 })).expect(400);
});

test('admin detail payload includes SKU and complete audit actor without altering data', async () => {
  const before = fs.readFileSync(path.join(dataDir, 'orders.json'));
  const result = await auth(request(app).get('/api/orders').query({ search: 'DOD-ORD-1001', page: 1, limit: 10 })).expect(200);
  assert.equal(result.body.orders[0].items[0].sku, 'DOD-0001');
  assert.equal(result.body.orders[0].statusHistory[0].changedBy, 'system');
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'orders.json')), before);
});

test('card payment cannot be marked collected by an admin action', async () => {
  const before = read('orders')[0];
  const result = await auth(request(app).patch('/api/orders/' + before.id + '/payment').send({})).expect(409);
  assert.equal(result.body.code, 'PROVIDER_VERIFICATION_REQUIRED');
  const afterOrder = read('orders')[0];
  assert.equal(afterOrder.paymentStatus, before.paymentStatus);
  assert.equal(afterOrder.status, before.status);
  assert.deepEqual(afterOrder.statusHistory, before.statusHistory);
});

test('all internal order and payment enums have professional Uzbek labels', () => {
  for (const status of statuses) {
    assert.notEqual(labels.status(status), status);
    assert.doesNotMatch(labels.status(status), /pending|production|shipped|delivered|confirmed/i);
  }
  for (const payment of ['pending', 'collected', 'failed']) assert.notEqual(labels.payment(payment), payment);
});
