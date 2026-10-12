'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const request = require('supertest');
const { applySchema } = require('../../utils/postgres/schema');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dodola-neon-express-'));
  const dataDir = path.join(root, 'data'), uploadsDir = path.join(root, 'uploads');
  fs.mkdirSync(dataDir); fs.mkdirSync(uploadsDir);
  const files = { products: [], orders: [], categories: ['Sinov'], promocodes: [], reviews: [], 'identifier-counters': {},
    'inventory-state': { applied: true, inventoryVersion: 1 }, customers: [], 'customer-sessions': {}, 'auth-tokens': [] };
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(value));
  return { root, dataDir, uploadsDir };
}

function orderBody(token) {
  return { name: 'Izolyatsiya testi', phone: '+998901234567', address: 'Toshkent, izolyatsiya testi', paymentType: 'naqd',
    submissionToken: token, items: [{ productId: 'neon-route-product', qty: 1 }] };
}

async function run() {
  const raw = String(process.env.DATABASE_URL || '').trim(), expectedHost = String(process.env.EXPECTED_NEON_TEST_HOST || '').trim().toLowerCase();
  if (!raw || !expectedHost) throw new Error('DATABASE_URL va EXPECTED_NEON_TEST_HOST process muhitida talab qilinadi.');
  const parsed = new URL(raw);
  if (parsed.hostname.toLowerCase() !== expectedHost || !expectedHost.includes('ep-winter-wildflower-ban7x0vd')) {
    throw Object.assign(new Error('Ulanish tasdiqlangan Neon TEST endpointiga tegishli emas.'), { code: 'TEST_ENDPOINT_MISMATCH' });
  }
  const schema = `express_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Pool({ connectionString: raw, ssl: { rejectUnauthorized: false }, max: 1, application_name: 'dodola-neon-express-setup' });
  const files = fixture(); let pool;
  const report = { branchVerified: true, temporarySchemaCreated: false, temporarySchemaRemoved: false, checks: {} };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); report.temporarySchemaCreated = true;
    pool = new Pool({ connectionString: raw, ssl: { rejectUnauthorized: false }, max: 8,
      options: `-c search_path=${schema}`, application_name: 'dodola-neon-express-test' });
    await applySchema(pool);
    await pool.query(`INSERT INTO products (id,sku,name,description,category,price,inventory_mode,accepts_mto,primary_image,image_paths,legacy_payload,created_at,updated_at)
      VALUES ('neon-route-product','DOD-9901','Neon route sinovi','Izolyatsiya','Sinov',1000,'standard',false,'','[]','{}',now(),now()),
      ('neon-business-product','DOD-9902','Neon biznes sinovi','Izolyatsiya','Sinov',10000,'standard',false,'','[]','{}',now(),now())`);
    await pool.query(`INSERT INTO inventory_levels (product_id,available,reserved,sold,returned,low_stock_threshold,inventory_version)
      VALUES ('neon-route-product',3,0,0,0,5,1),('neon-business-product',3,0,0,0,5,1)`);
    await pool.query(`INSERT INTO categories (source_index,name,legacy_payload) VALUES (0,'Sinov','"Sinov"')`);
    await pool.query(`INSERT INTO promo_codes (code,discount_percent,created_at,legacy_payload,usage_limit)
      VALUES ('NEON10',10,now(),'{"code":"NEON10","discountPercent":10}',1)`);
    process.env.JWT_SECRET ||= 'neon-express-test-secret-at-least-32-characters';
    process.env.ADMIN_USERNAME ||= 'neon-test-admin'; process.env.ADMIN_PASSWORD ||= crypto.randomBytes(24).toString('hex');
    process.env.CUSTOMER_SESSION_SECRET ||= 'neon-express-session-secret-at-least-32'; process.env.NODE_ENV = 'test';
    const { createApp } = require('../../server');
    const app = createApp({ dataDir: files.dataDir, uploadsDir: files.uploadsDir, storageBackend: 'postgresql', postgresPool: pool,
      emailService: { baseUrl: 'http://localhost', status: () => ({ configured: true, testMode: true }), send: async () => ({ accepted: true, id: 'mocked' }) } });
    const products = await request(app).get('/api/products?search=DOD-9901');
    report.checks.productRoute = products.status === 200 && products.body.length === 1;
    const first = await request(app).post('/api/orders').send(orderBody('neon-idempotent-0001'));
    const duplicate = await request(app).post('/api/orders').send(orderBody('neon-idempotent-0001'));
    report.checks.checkout = first.status === 201;
    report.checks.idempotency = duplicate.status === 201 && duplicate.body.order.id === first.body.order.id;
    const parallel = await Promise.all(Array.from({ length: 4 }, (_, index) => request(app).post('/api/orders').send(orderBody(`neon-parallel-${String(index).padStart(4, '0')}`))));
    report.checks.concurrentDepletion = parallel.filter(row => row.status === 201).length === 2 && parallel.filter(row => row.status === 400).length === 2;
    const balance = (await pool.query("SELECT available,reserved,sold FROM inventory_levels WHERE product_id='neon-route-product'")).rows[0];
    report.checks.noOversell = Number(balance.available) === 0 && Number(balance.reserved) === 3 && Number(balance.sold) === 0;
    const tracked = await request(app).get('/api/orders/track').query({ orderNumber: first.body.order.orderNumber });
    report.checks.publicTrackingPrivate = tracked.status === 200 && tracked.body.phone === undefined && tracked.body.address === undefined;
    const adminLogin = await request(app).post('/api/admin/login').send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
    const auth = { Authorization: `Bearer ${adminLogin.body.token}` };
    const createdCategory = await request(app).post('/api/categories').set(auth).send({ name: 'Neon vaqtinchalik' });
    const renamedCategory = await request(app).put('/api/categories/Sinov').set(auth).send({ name: 'Neon yangilangan' });
    const categoryPersisted = (await pool.query("SELECT count(*) AS value FROM products WHERE category='Neon yangilangan'")).rows[0];
    const protectedDelete = await request(app).delete('/api/categories/Neon%20yangilangan').set(auth);
    const removedCategory = await request(app).delete('/api/categories/Neon%20vaqtinchalik').set(auth);
    report.checks.categories = createdCategory.status === 200 && renamedCategory.status === 200 && Number(categoryPersisted.value) === 2 &&
      protectedDelete.status === 409 && removedCategory.status === 200;
    const promoAttempts = await Promise.all(['neon-promo-order-0001','neon-promo-order-0002'].map(submissionToken => request(app).post('/api/orders').send({
      name: 'Promokod testi', phone: '+998901234567', address: 'Toshkent, promokod testi', paymentType: 'naqd', submissionToken,
      promoCode: 'NEON10', items: [{ productId: 'neon-business-product', qty: 1 }]
    })));
    const promoState = (await pool.query("SELECT redeemed_count FROM promo_codes WHERE code='NEON10'")).rows[0];
    report.checks.transactionalPromo = promoAttempts.filter(row => row.status === 201).length === 1 &&
      promoAttempts.filter(row => row.status === 400).length === 1 && Number(promoState.redeemed_count) === 1;
    const review = await request(app).post('/api/reviews').send({ productId: 'neon-business-product', name: 'Neon sinovchi', rating: 5, review: 'Yaxshi' });
    const reviews = await request(app).get('/api/reviews?productId=neon-business-product');
    const deletedReview = review.status === 200 ? await request(app).delete(`/api/reviews/${review.body.review.id}`).set(auth) : { status: 0 };
    report.checks.reviews = review.status === 200 && reviews.status === 200 && reviews.body.length === 1 && deletedReview.status === 200;
    report.ok = Object.values(report.checks).every(Boolean);
    if (!report.ok) throw Object.assign(new Error('Neon Express integratsiya tekshiruvi muvaffaqiyatsiz.'), { code: 'NEON_EXPRESS_CHECK_FAILED' });
    return report;
  } finally {
    if (pool) await pool.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    report.temporarySchemaRemoved = true;
    await admin.end(); fs.rmSync(files.root, { recursive: true, force: true });
  }
}

if (require.main === module) run().then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n')).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'NEON_EXPRESS_TEST_FAILED', message: error.message }) + '\n'); process.exitCode = 1;
});
module.exports = { run };
