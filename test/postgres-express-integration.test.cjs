'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { newDb, DataType } = require('pg-mem');

process.env.JWT_SECRET = 'postgres-express-isolated-secret-at-least-32-chars';
process.env.ADMIN_USERNAME = 'isolated-admin';
process.env.ADMIN_PASSWORD = 'isolated-admin-password';
process.env.CUSTOMER_SESSION_SECRET = 'isolated-customer-session-secret-at-least-32';
process.env.NODE_ENV = 'test';

const { createApp } = require('../server');
const { applySchema } = require('../utils/postgres/schema');

function memoryPool() {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerOperator({ operator: '~', left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (a, b) => new RegExp(b).test(a) });
  db.public.registerFunction({ name: 'setval', args: [DataType.text, DataType.integer, DataType.bool], returns: DataType.integer, implementation: (_s, value) => value });
  db.public.registerFunction({ name: 'hashtext', args: [DataType.text], returns: DataType.integer, implementation: value => value.length });
  db.public.registerFunction({ name: 'pg_advisory_xact_lock', args: [DataType.integer], returns: DataType.integer, implementation: () => 1 });
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dodola-pg-express-'));
  const dataDir = path.join(root, 'data'), uploadsDir = path.join(root, 'uploads');
  fs.mkdirSync(dataDir); fs.mkdirSync(uploadsDir);
  for (const [name, value] of Object.entries({ products: [], orders: [], categories: ['Sinov'], promocodes: [], reviews: [],
    'identifier-counters': {}, 'inventory-state': { applied: true, inventoryVersion: 1 }, customers: [], 'customer-sessions': {}, 'auth-tokens': [] })) {
    fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(value));
  }
  return { root, dataDir, uploadsDir };
}

async function setup() {
  const pool = memoryPool(), files = fixture(), emails = [];
  await applySchema(pool);
  await pool.query(`INSERT INTO products (id,sku,name,description,category,price,inventory_mode,accepts_mto,primary_image,image_paths,legacy_payload,created_at,updated_at)
    VALUES ('pg-product','DOD-9001','PostgreSQL mahsulot','Sinov tavsifi','Sinov',10000,'standard',false,'uploads/test.webp','["uploads/test.webp"]','{"colors":"","sizes":""}',now(),now()),
    ('pg-mto','DOD-9002','Buyurtma asosida','Sinov tavsifi','Sinov',15000,'made-to-order',true,'uploads/test.webp','["uploads/test.webp"]','{"colors":"","sizes":""}',now(),now())`);
  await pool.query(`INSERT INTO inventory_levels (product_id,available,reserved,sold,returned,low_stock_threshold,inventory_version)
    VALUES ('pg-product',3,0,0,0,5,1),('pg-mto',4,0,0,0,5,1)`);
  await pool.query(`INSERT INTO categories (source_index,name,legacy_payload) VALUES (0,'Sinov','"Sinov"')`);
  await pool.query(`INSERT INTO promo_codes (code,discount_percent,created_at,legacy_payload,usage_limit)
    VALUES ('ONCE10',10,now(),'{"code":"ONCE10","discountPercent":10}',1)`);
  const emailService = { baseUrl: 'http://localhost:3000', status: () => ({ configured: true, provider: 'mock', testMode: true }),
    send: async message => { emails.push(message); return { accepted: true, id: `mail-${emails.length}` }; } };
  const app = createApp({ dataDir: files.dataDir, uploadsDir: files.uploadsDir, storageBackend: 'postgresql', postgresPool: pool,
    postgresOrderOptions: { isolationLevel: null }, emailService });
  return { pool, files, emails, app };
}

async function csrf(agent) { return (await agent.get('/api/auth/session').expect(200)).body.csrfToken; }
function tokenFrom(message, key) {
  const match = String(message.html || message.text || '').match(new RegExp(`${key}=([^&"'<\\s]+)`));
  return match && decodeURIComponent(match[1]);
}
function orderBody(productId, token, qty = 1, extra = {}) {
  return { name: 'Test Mijoz', phone: '+998901234567', address: 'Toshkent shahri, sinov manzili', paymentType: 'naqd',
    submissionToken: token, items: [{ productId, qty }], ...extra };
}

test('PostgreSQL-backed Express routes cover auth, profile, checkout, tracking and admin actions', async () => {
  const ctx = await setup();
  try {
    const agent = request.agent(ctx.app); let csrfToken = await csrf(agent);
    await agent.post('/api/auth/register').set('X-CSRF-Token', csrfToken).send({ firstName: 'Ali', lastName: 'Valiyev', phone: '+998901112233',
      email: 'ali@example.invalid', password: 'Securepass123', confirmPassword: 'Securepass123' }).expect(201);
    assert.equal(ctx.emails.length, 1);
    const verifyToken = tokenFrom(ctx.emails[0], 'verify'); assert.ok(verifyToken);
    await agent.post('/api/auth/verify-email').set('X-CSRF-Token', csrfToken).send({ token: verifyToken }).expect(200);
    await agent.post('/api/auth/verify-email').set('X-CSRF-Token', csrfToken).send({ token: verifyToken }).expect(400);
    const login = await agent.post('/api/auth/login').set('X-CSRF-Token', csrfToken).send({ identifier: '+998901112233', password: 'Securepass123' }).expect(200);
    csrfToken = login.body.csrfToken;
    await agent.patch('/api/customer/profile').set('X-CSRF-Token', csrfToken).send({ firstName: 'Alisher' }).expect(200);
    await agent.put('/api/customer/addresses').set('X-CSRF-Token', csrfToken).send({ label: 'Uy', address: 'Toshkent, Chilonzor tumani' }).expect(200);

    const productList = await agent.get('/api/products?search=DOD-9001').expect(200);
    assert.equal(productList.body.length, 1);
    const placed = await agent.post('/api/orders').send(orderBody('pg-product', 'authenticated-order-0001')).expect(201);
    assert.match(placed.body.order.orderNumber, /^DOD-ORD-/);
    const mine = await agent.get('/api/customer/orders').expect(200);
    assert.equal(mine.body.orders.length, 1);

    await agent.post('/api/auth/forgot-password').set('X-CSRF-Token', csrfToken).send({ email: 'ali@example.invalid' }).expect(200);
    const resetToken = tokenFrom(ctx.emails.at(-1), 'token'); assert.ok(resetToken);
    await agent.post('/api/auth/reset-password').set('X-CSRF-Token', csrfToken).send({ token: resetToken, password: 'Changedpass456', confirmPassword: 'Changedpass456' }).expect(200);
    csrfToken = await csrf(agent);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrfToken).send({ identifier: '+998901112233', password: 'Securepass123' }).expect(401);
    const relogin = await agent.post('/api/auth/login').set('X-CSRF-Token', csrfToken).send({ identifier: '+998901112233', password: 'Changedpass456' }).expect(200);
    csrfToken = relogin.body.csrfToken;

    const guest = await request(ctx.app).post('/api/orders').send(orderBody('pg-mto', 'guest-order-token-0001')).expect(201);
    const summary = await request(ctx.app).get('/api/orders/track').query({ orderNumber: guest.body.order.orderNumber }).expect(200);
    assert.equal(summary.body.address, undefined);
    const secure = await request(ctx.app).post('/api/orders/track/secure').send({ orderNumber: guest.body.order.orderNumber,
      trackingToken: guest.body.order.trackingToken }).expect(200);
    assert.equal(secure.body.order.items.length, 1);
    await request(ctx.app).post('/api/orders/track/secure').send({ orderNumber: guest.body.order.orderNumber, trackingToken: 'x'.repeat(40) }).expect(404);

    const adminLogin = await request(ctx.app).post('/api/admin/login').send({ username: 'isolated-admin', password: 'isolated-admin-password' }).expect(200);
    const auth = { Authorization: `Bearer ${adminLogin.body.token}` };
    const listed = await request(ctx.app).get('/api/orders?search=DOD-ORD&filter=all&sort=newest&page=1&limit=10').set(auth).expect(200);
    assert.equal(listed.body.meta.total, 2);
    await request(ctx.app).patch('/api/products/pg-product/stock').set(auth).send({ change: -1, reason: 'Route sinovi' }).expect(200);
    await request(ctx.app).patch('/api/products/pg-product/stock').set(auth).send({ change: 1, reason: 'Route sinovi qaytarildi' }).expect(200);
    const history = await request(ctx.app).get('/api/products/pg-product/stock-history?page=1&limit=10').set(auth).expect(200);
    assert.equal(history.body.history.length, 3);
    await request(ctx.app).patch(`/api/orders/${placed.body.order.id}/payment`).set(auth).send({ reason: 'Naqd to‘lov olindi' }).expect(200);
    await request(ctx.app).patch(`/api/orders/${placed.body.order.id}/payment`).set(auth).send({ reason: 'Takroriy so‘rov' }).expect(200);
    await request(ctx.app).patch(`/api/orders/${guest.body.order.id}/reject`).set(auth).send({ reason: 'Sinov rad etish' }).expect(200);
    const level = (await ctx.pool.query("SELECT available,reserved FROM inventory_levels WHERE product_id='pg-mto'")).rows[0];
    assert.deepEqual([Number(level.available), Number(level.reserved)], [4, 0]);
    const paidLevel = (await ctx.pool.query("SELECT available,reserved,sold FROM inventory_levels WHERE product_id='pg-product'")).rows[0];
    assert.deepEqual([Number(paidLevel.available), Number(paidLevel.reserved), Number(paidLevel.sold)], [2, 0, 1]);
  } finally { await ctx.pool.end(); fs.rmSync(ctx.files.root, { recursive: true, force: true }); }
});

test('PostgreSQL checkout idempotency and stock depletion do not oversell', async () => {
  const ctx = await setup();
  try {
    const { PostgresCatalogRepository } = require('../utils/postgres/catalogRepository');
    const catalogRows = await new PostgresCatalogRepository(ctx.pool).listProducts();
    assert.ok(catalogRows.some(row => row.id === 'pg-product'), JSON.stringify(catalogRows));
    const first = await request(ctx.app).post('/api/orders').send(orderBody('pg-product', 'same-submission-0001', 1));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const duplicate = await request(ctx.app).post('/api/orders').send(orderBody('pg-product', 'same-submission-0001', 1)).expect(201);
    assert.equal(duplicate.body.order.id, first.body.order.id);
    const responses = [];
    for (let index = 0; index < 4; index += 1) responses.push(await request(ctx.app).post('/api/orders')
      .send(orderBody('pg-product', `depletion-submission-${index}`, 1)));
    assert.equal(responses.filter(row => row.status === 201).length, 2);
    assert.equal(responses.filter(row => row.status === 400).length, 2);
    const level = (await ctx.pool.query("SELECT available,reserved,sold FROM inventory_levels WHERE product_id='pg-product'")).rows[0];
    assert.deepEqual([Number(level.available), Number(level.reserved), Number(level.sold)], [0, 3, 0]);
    assert.equal(Number((await ctx.pool.query("SELECT count(*) AS count FROM orders WHERE public_order_number IS NOT NULL")).rows[0].count), 3);
  } finally { await ctx.pool.end(); fs.rmSync(ctx.files.root, { recursive: true, force: true }); }
});

test('PostgreSQL categories, promo redemption and reviews use authoritative repositories', async () => {
  const ctx = await setup();
  try {
    const adminLogin = await request(ctx.app).post('/api/admin/login').send({ username: 'isolated-admin', password: 'isolated-admin-password' }).expect(200);
    const auth = { Authorization: `Bearer ${adminLogin.body.token}` };

    assert.deepEqual((await request(ctx.app).get('/api/categories').expect(200)).body, ['Sinov']);
    await request(ctx.app).post('/api/categories').set(auth).send({ name: 'Vaqtinchalik' }).expect(200);
    await request(ctx.app).put('/api/categories/Sinov').set(auth).send({ name: 'Yangilangan' }).expect(200);
    assert.equal((await ctx.pool.query("SELECT category FROM products WHERE id='pg-product'")).rows[0].category, 'Yangilangan');
    await request(ctx.app).delete('/api/categories/Yangilangan').set(auth).expect(409);
    await request(ctx.app).delete('/api/categories/Vaqtinchalik').set(auth).expect(200);

    const applied = await request(ctx.app).post('/api/promocodes/apply').send({ code: 'once10', subtotal: 10000 }).expect(200);
    assert.equal(applied.body.total, 9000);
    const promoTokens = ['promo-order-token-0001', 'promo-order-token-0002'];
    const attempts = await Promise.all(promoTokens.map(token =>
      request(ctx.app).post('/api/orders').send(orderBody('pg-product', token, 1, { promoCode: 'ONCE10' }))));
    assert.equal(attempts.filter(row => row.status === 201).length, 1);
    assert.equal(attempts.filter(row => row.status === 400).length, 1);
    assert.equal(Number((await ctx.pool.query("SELECT redeemed_count FROM promo_codes WHERE code='ONCE10'")).rows[0].redeemed_count), 1);
    assert.equal(Number((await ctx.pool.query("SELECT count(*) AS value FROM promo_redemptions WHERE promo_code='ONCE10'")).rows[0].value), 1);
    const winnerIndex = attempts.findIndex(row => row.status === 201), winner = attempts[winnerIndex];
    const duplicate = await request(ctx.app).post('/api/orders').send(orderBody('pg-product', promoTokens[winnerIndex], 1, { promoCode: 'ONCE10' })).expect(201);
    assert.equal(duplicate.body.order.id, winner.body.order.id);
    assert.equal(Number((await ctx.pool.query("SELECT redeemed_count FROM promo_codes WHERE code='ONCE10'")).rows[0].redeemed_count), 1);
    await request(ctx.app).delete('/api/promocodes/ONCE10').set(auth).expect(409);

    const created = await request(ctx.app).post('/api/reviews').send({ productId: 'pg-product', name: 'Sinovchi', rating: 5, review: 'Yaxshi mahsulot' }).expect(200);
    assert.equal(created.body.review.productId, 'pg-product');
    assert.equal((await request(ctx.app).get('/api/reviews?productId=pg-product').expect(200)).body.length, 1);
    await request(ctx.app).delete(`/api/reviews/${created.body.review.id}`).set(auth).expect(200);
    assert.equal((await request(ctx.app).get('/api/reviews?productId=pg-product').expect(200)).body.length, 0);
  } finally { await ctx.pool.end(); fs.rmSync(ctx.files.root, { recursive: true, force: true }); }
});
