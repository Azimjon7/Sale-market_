const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'warehouse-isolated-secret-at-least-32-characters';
process.env.ADMIN_USERNAME = 'warehouse-admin';
process.env.ADMIN_PASSWORD = 'warehouse-password';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

const { createApp } = require('../server');
const { initializeProductInventory } = require('../utils/stockReservation');
const { migrateWarehouseInventory } = require('../scripts/migrate-warehouse-inventory');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, '.local-tests', 'warehouse-' + crypto.randomUUID());
const dataDir = path.join(fixture, 'data');
const uploadsDir = path.join(fixture, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
fs.writeFileSync(path.join(uploadsDir, 'product.png'), 'isolated');
const file = name => path.join(dataDir, name + '.json');
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
const admin = jwt.sign({ username: 'warehouse-admin', role: 'admin' }, process.env.JWT_SECRET);
const auth = { Authorization: 'Bearer ' + admin };

function baseProduct(id = 'warehouse', mode = 'made-to-order') {
  return { id, sku: 'DOD-0001', name: 'Izolyatsiyalangan mahsulot', price: 100000, category: 'Sinov',
    desc: 'Faqat avtomatik sinov uchun', image: 'uploads/product.png', images: ['uploads/product.png'],
    colors: 'Qora,Oq', sizes: 'M,L', stock: 0, _inventoryMode: mode, _acceptsMTO: mode === 'made-to-order' };
}
function managedProduct(units = 15, mode = 'made-to-order') {
  return initializeProductInventory(baseProduct('warehouse', mode), units, 'test', '2026-01-01T00:00:00.000Z').product;
}
function orderPayload(qty = 1, extra = {}) {
  return { name: 'Izolyatsiyalangan mijoz', phone: '+998900000000', address: 'Sinov manzili 10',
    items: [{ productId: 'warehouse', qty, color: 'Qora', size: 'M' }], ...extra };
}

let app;
beforeEach(() => {
  write('products', [managedProduct()]); write('orders', []); write('categories', ['Sinov']);
  write('promocodes', []); write('reviews', []); write('identifier-counters', { nextSku: 2, nextOrderNumber: 1001 });
  write('inventory-state', { applied: true, inventoryVersion: 1, productCount: 1, startingUnits: 15 });
  app = createApp({ dataDir, uploadsDir, notifyOrder: async () => {} });
});
after(() => fs.rmSync(fixture, { recursive: true, force: true }));

test('migration initializes 1,164 products once, preserves catalog fields and leaves orders byte-for-byte unchanged', async () => {
  const migrationDir = path.join(fixture, 'migration'); fs.mkdirSync(migrationDir, { recursive: true });
  const products = Array.from({ length: 1164 }, (_, index) => ({ ...baseProduct('p' + index, index % 2 ? 'standard' : 'made-to-order'),
    sku: 'DOD-' + String(index + 1).padStart(4, '0'), name: 'Mahsulot ' + index, price: index + 10,
    images: ['uploads/' + index + '.webp'], image: 'uploads/' + index + '.webp', colors: 'Qora,Oq', sizes: 'M,L' }));
  const orders = [{ id: 'historical', orderNumber: 'DOD-ORD-1001', status: 'delivered' }];
  fs.writeFileSync(path.join(migrationDir, 'products.json'), JSON.stringify(products));
  fs.writeFileSync(path.join(migrationDir, 'orders.json'), JSON.stringify(orders));
  const orderBytes = fs.readFileSync(path.join(migrationDir, 'orders.json'));
  const result = await migrateWarehouseInventory({ dataDir: migrationDir, apply: true,
    backupDir: path.join(fixture, 'migration-backup'), timestamp: '2026-01-02T00:00:00.000Z' });
  assert.equal(result.initializedCount, 1164); assert.equal(result.totalStartingUnits, 17460);
  const migrated = JSON.parse(fs.readFileSync(path.join(migrationDir, 'products.json')));
  assert.equal(new Set(migrated.map(p => p.sku)).size, 1164);
  migrated.forEach((product, index) => {
    assert.equal(product.id, products[index].id); assert.equal(product.sku, products[index].sku);
    assert.equal(product.name, products[index].name); assert.equal(product.price, products[index].price);
    assert.deepEqual(product.images, products[index].images); assert.equal(product.colors, products[index].colors);
    assert.equal(product.sizes, products[index].sizes); assert.equal(product._inventoryMode, products[index]._inventoryMode);
    assert.equal(product.available, 15); assert.equal(product.stock, 15); assert.equal(product.reserved, 0);
  });
  assert.deepEqual(fs.readFileSync(path.join(migrationDir, 'orders.json')), orderBytes);
  const beforeSecond = fs.readFileSync(path.join(migrationDir, 'products.json'));
  const second = await migrateWarehouseInventory({ dataDir: migrationDir, apply: true });
  assert.equal(second.initializedCount, 0); assert.deepEqual(fs.readFileSync(path.join(migrationDir, 'products.json')), beforeSecond);
});

test('dry run does not modify isolated product data', async () => {
  const dryDir = path.join(fixture, 'dry'); fs.mkdirSync(dryDir, { recursive: true });
  fs.writeFileSync(path.join(dryDir, 'products.json'), JSON.stringify([baseProduct()]));
  fs.writeFileSync(path.join(dryDir, 'orders.json'), '[]');
  const before = fs.readFileSync(path.join(dryDir, 'products.json'));
  const result = await migrateWarehouseInventory({ dataDir: dryDir, apply: false });
  assert.equal(result.initializedCount, 1); assert.deepEqual(fs.readFileSync(path.join(dryDir, 'products.json')), before);
  assert.equal(fs.existsSync(path.join(dryDir, 'inventory-state.json')), false);
});

test('shared stock aggregates variant rows and records one reservation', async () => {
  const response = await request(app).post('/api/orders').send({ ...orderPayload(8), items: [
    { productId: 'warehouse', qty: 8, color: 'Qora', size: 'M' },
    { productId: 'warehouse', qty: 7, color: 'Oq', size: 'L' },
  ] }).expect(201);
  const product = read('products')[0]; const order = read('orders')[0];
  assert.equal(product.available, 0); assert.equal(product.stock, 0); assert.equal(product.reserved, 15);
  assert.equal(order.stockReservations.length, 1); assert.equal(order.stockReservations[0].qty, 15);
  assert.equal(response.body.success, true);
  await request(app).post('/api/orders').send(orderPayload(1)).expect(400);
  assert.equal(read('orders').length, 1);
});

test('parallel order creation cannot oversell', async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => request(app).post('/api/orders')
    .send(orderPayload(1, { submissionToken: 'parallel-token-' + String(index).padStart(2, '0') }))));
  assert.equal(responses.filter(row => row.status === 201).length, 15);
  assert.equal(responses.filter(row => row.status === 400).length, 5);
  assert.equal(read('products')[0].available, 0); assert.equal(read('products')[0].reserved, 15);
  assert.equal(read('orders').length, 15);
});

test('idempotent retry does not reserve twice', async () => {
  const token = 'idempotent-warehouse-token';
  const first = await request(app).post('/api/orders').send(orderPayload(3, { submissionToken: token })).expect(201);
  const second = await request(app).post('/api/orders').send(orderPayload(3, { submissionToken: token })).expect(201);
  assert.equal(first.body.order.id, second.body.order.id);
  assert.equal(read('orders').length, 1); assert.equal(read('products')[0].available, 12); assert.equal(read('products')[0].reserved, 3);
});

test('confirmation commits exactly once without a second available-stock deduction', async () => {
  const created = await request(app).post('/api/orders').send(orderPayload(4)).expect(201);
  await request(app).patch(`/api/orders/${created.body.order.id}/confirm`).set(auth).send({ reason: 'Tasdiqlandi' }).expect(200);
  const product = read('products')[0];
  assert.equal(product.available, 11); assert.equal(product.reserved, 0); assert.equal(product.sold, 4);
  await request(app).patch(`/api/orders/${created.body.order.id}/confirm`).set(auth).send({ reason: 'Qayta' }).expect(409);
  assert.deepEqual(read('products')[0], product);
});

test('rejection releases a reservation exactly once', async () => {
  const created = await request(app).post('/api/orders').send(orderPayload(5)).expect(201);
  await request(app).patch(`/api/orders/${created.body.order.id}/reject`).set(auth).send({ reason: 'Mijoz bekor qildi' }).expect(200);
  const product = read('products')[0]; assert.equal(product.available, 15); assert.equal(product.reserved, 0);
  assert.equal(product.stockHistory.filter(row => row.type === 'order_restored').length, 1);
  await request(app).patch(`/api/orders/${created.body.order.id}/reject`).set(auth).send({ reason: 'Takror' }).expect(409);
  assert.deepEqual(read('products')[0], product);
});

test('a committed order rejected under existing transition rules returns units once', async () => {
  const created = await request(app).post('/api/orders').send(orderPayload(3)).expect(201);
  await request(app).patch(`/api/orders/${created.body.order.id}/confirm`).set(auth).send({ reason: 'Tasdiqlandi' }).expect(200);
  let product = read('products')[0]; assert.equal(product.available, 12); assert.equal(product.reserved, 0); assert.equal(product.sold, 3);
  await request(app).patch(`/api/orders/${created.body.order.id}/reject`).set(auth)
    .send({ reason: 'Mijoz to‘lovdan oldin bekor qildi' }).expect(200);
  product = read('products')[0]; assert.equal(product.available, 15); assert.equal(product.reserved, 0);
  assert.equal(product.sold, 0); assert.equal(product.returned, 3);
  assert.equal(product.stockHistory.filter(row => row.type === 'order_restored').length, 1);
});

test('unverified card payment cannot commit inventory', async () => {
  const products = read('products'); products[0]._inventoryMode = 'standard'; write('products', products);
  const created = await request(app).post('/api/orders').send(orderPayload(2, { paymentType: 'karta' })).expect(201);
  const before = read('products')[0];
  await request(app).patch(`/api/orders/${created.body.order.id}/payment`).set(auth).send({}).expect(409);
  assert.deepEqual(read('products')[0], before); assert.equal(read('orders')[0].paymentStatus, 'pending');
});

test('admin stock adjustment is protected, audited, validates reasons and warns at five', async () => {
  await request(app).patch('/api/products/warehouse/stock').send({ change: -10, reason: 'Sanov' }).expect(401);
  await request(app).patch('/api/products/warehouse/stock').set(auth).send({ change: -20, reason: 'Sanov' }).expect(400);
  await request(app).patch('/api/products/warehouse/stock').set(auth).send({ change: -10, reason: 'Ombor sanog‘i' }).expect(200);
  const product = read('products')[0]; assert.equal(product.available, 5);
  const movement = product.stockHistory.at(-1); assert.equal(movement.type, 'admin_adjustment');
  assert.equal(movement.actor, 'warehouse-admin'); assert.equal(movement.reason, 'Ombor sanog‘i');
  const history = await request(app).get('/api/products/warehouse/stock-history').set(auth).expect(200);
  assert.equal(history.body.inventory.isLowStock, true);
  await request(app).get('/api/products/warehouse/stock-history').expect(401);
  await request(app).get('/api/products/warehouse/stock-history/export').set(auth).expect(200).expect('Content-Type', /text\/csv/);
});

test('normal product edit cannot overwrite managed balances and active reservations block deletion', async () => {
  const update = { ...baseProduct(), name: 'Yangilangan nom', stock: 999, existingImages: 'uploads/product.png' };
  await request(app).put('/api/products/warehouse').set(auth).field(update).expect(200);
  assert.equal(read('products')[0].available, 15); assert.equal(read('products')[0].stock, 15);
  const created = await request(app).post('/api/orders').send(orderPayload(1)).expect(201);
  await request(app).delete(`/api/orders/${created.body.order.id}`).set(auth).expect(409);
  await request(app).delete('/api/products/warehouse').set(auth).expect(409);
});

test('historical orders stay unchanged while new managed orders use versioned reservations', async () => {
  const historical = { id: 'old', orderNumber: 'DOD-ORD-0900', status: 'delivered', items: [{ productId: 'warehouse', qty: 2 }] };
  write('orders', [historical]);
  await request(app).post('/api/orders').send(orderPayload(1)).expect(201);
  assert.deepEqual(read('orders')[1], historical);
  assert.equal(read('orders')[0].stockReservations[0].inventoryVersion, 1);
});
