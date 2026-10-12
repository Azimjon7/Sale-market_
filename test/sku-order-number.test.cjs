const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.JWT_SECRET = 'isolated-sku-order-test-secret-at-least-32-characters';
process.env.ADMIN_USERNAME = 'isolated-admin';
process.env.ADMIN_PASSWORD = 'isolated-password';
process.env.NODE_ENV = 'test';

const { createApp } = require('../server');
const { migrateIdentifiers } = require('../scripts/migrate-identifiers');

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function fixtureProduct(id, extra = {}) {
  return {
    id,
    name: `Product ${id}`,
    category: 'Test',
    desc: `Description ${id}`,
    price: 100,
    image: 'img/placeholders/product.svg',
    images: ['img/placeholders/product.svg'],
    stock: 0,
    _inventoryMode: 'made-to-order',
    ...extra,
  };
}

function makeProject(productCount = 1, orderCount = 0) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dodola-identifiers-'));
  const dataDir = path.join(projectRoot, 'data');
  const uploadsDir = path.join(projectRoot, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  write(path.join(dataDir, 'products.json'), Array.from({ length: productCount }, (_, index) => fixtureProduct(`p-${index + 1}`)));
  write(path.join(dataDir, 'orders.json'), Array.from({ length: orderCount }, (_, index) => ({
    id: `legacy-${index + 1}`,
    name: 'Private customer',
    phone: '+998900000000',
    address: 'Private address',
    items: [],
    status: 'shipped',
    paymentStatus: 'collected',
    createdAt: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
  })));
  for (const name of ['categories', 'promocodes', 'reviews']) write(path.join(dataDir, `${name}.json`), []);
  return { projectRoot, dataDir, uploadsDir };
}

const adminToken = jwt.sign({ username: 'isolated-admin', role: 'admin' }, process.env.JWT_SECRET);
const auth = requestBuilder => requestBuilder.set('Authorization', `Bearer ${adminToken}`);

test('idempotent migration assigns 1,164 unique immutable-format SKUs and preserves source fields', async t => {
  const fixture = makeProject(1164, 10);
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  const before = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'products.json')));
  const first = await migrateIdentifiers(fixture);
  assert.equal(first.productSkusAssigned, 1164);
  assert.equal(first.orderNumbersAssigned, 10);

  const products = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'products.json')));
  const orders = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'orders.json')));
  assert.equal(new Set(products.map(product => product.sku)).size, 1164);
  assert.ok(products.every(product => /^DOD-\d{4,}$/.test(product.sku)));
  assert.deepEqual(products.map(({ sku, ...product }) => product), before);
  assert.equal(new Set(orders.map(order => order.orderNumber)).size, 10);
  assert.ok(orders.every(order => /^DOD-ORD-\d{4,}$/.test(order.orderNumber)));

  const productsSnapshot = fs.readFileSync(path.join(fixture.dataDir, 'products.json'), 'utf8');
  const ordersSnapshot = fs.readFileSync(path.join(fixture.dataDir, 'orders.json'), 'utf8');
  const second = await migrateIdentifiers(fixture);
  assert.equal(second.changed, false);
  assert.equal(fs.readFileSync(path.join(fixture.dataDir, 'products.json'), 'utf8'), productsSnapshot);
  assert.equal(fs.readFileSync(path.join(fixture.dataDir, 'orders.json'), 'utf8'), ordersSnapshot);
});

test('product creation, edit, delete, SKU search, and concurrent allocation never reuse SKUs', async t => {
  const fixture = makeProject(1, 0);
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  await migrateIdentifiers(fixture);
  const app = createApp({ dataDir: fixture.dataDir, uploadsDir: fixture.uploadsDir, notifyOrder: async () => {} });
  const makeBody = index => ({
    name: `Created ${index}`,
    category: 'Test',
    desc: 'Created description',
    price: 200,
    inventoryMode: 'made-to-order',
    existingImages: 'img/placeholders/product.svg',
    sku: 'DOD-0001',
  });

  const created = await auth(request(app).post('/api/products')).send(makeBody('single')).expect(200);
  const firstSku = created.body.product.sku;
  assert.equal(firstSku, 'DOD-0002');
  const edited = await auth(request(app).put(`/api/products/${created.body.product.id}`))
    .send({ ...makeBody('edited'), sku: 'DOD-9999' }).expect(200);
  assert.equal(edited.body.product.sku, firstSku);
  const searched = await request(app).get('/api/products').query({ search: firstSku }).expect(200);
  assert.equal(searched.body.length, 1);
  await auth(request(app).delete(`/api/products/${created.body.product.id}`)).expect(200);

  const concurrent = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    auth(request(app).post('/api/products')).send(makeBody(index)).expect(200)));
  const skus = concurrent.map(result => result.body.product.sku);
  assert.equal(new Set(skus).size, skus.length);
  assert.ok(!skus.includes(firstSku));
});

test('new orders receive concurrent-safe public numbers and public tracking exposes status only', async t => {
  const fixture = makeProject(1, 0);
  t.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));
  await migrateIdentifiers(fixture);
  const app = createApp({ dataDir: fixture.dataDir, uploadsDir: fixture.uploadsDir, notifyOrder: async () => {} });
  const body = index => ({
    name: `Private customer ${index}`,
    phone: `+99890${String(index).padStart(7, '0')}`,
    address: 'Private delivery address',
    paymentType: 'naqd',
    submissionToken: `sku-order-test-${String(index).padStart(3, '0')}`,
    items: [{ productId: 'p-1', qty: 1 }],
  });

  const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    request(app).post('/api/orders').send(body(index)).expect(201)));
  const numbers = results.map(result => result.body.order.orderNumber);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.ok(numbers.every(number => /^DOD-ORD-\d{4,}$/.test(number)));

  const tracked = await request(app).get('/api/orders/track').query({ orderNumber: numbers[0] }).expect(200);
  assert.deepEqual(Object.keys(tracked.body).sort(), [
    'createdAt', 'orderNumber', 'paymentDeadline', 'paymentStatus', 'status', 'statusLabel', 'updatedAt'
  ]);
  for (const field of ['id', 'name', 'phone', 'address', 'items', 'total', 'paymentType', 'statusHistory']) {
    assert.equal(Object.hasOwn(tracked.body, field), false);
  }
  const stored = JSON.parse(fs.readFileSync(path.join(fixture.dataDir, 'orders.json')));
  await request(app).get('/api/orders/track').query({ orderNumber: stored[0].id }).expect(404);
  await request(app).get('/api/orders/track').query({ orderNumber: 'DOD-ORD-999999' }).expect(404);

  const adminOrders = await auth(request(app).get('/api/orders')).expect(200);
  assert.equal(adminOrders.body.length, 8);
  assert.ok(adminOrders.body[0].phone);
  assert.ok(adminOrders.body[0].orderNumber);
});
