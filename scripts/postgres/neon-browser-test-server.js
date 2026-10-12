'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { applySchema } = require('../../utils/postgres/schema');

async function main() {
  const raw = String(process.env.DATABASE_URL || '').trim(), expected = String(process.env.EXPECTED_NEON_TEST_HOST || '').trim().toLowerCase();
  if (!raw || new URL(raw).hostname.toLowerCase() !== expected || !expected.includes('ep-winter-wildflower-ban7x0vd')) throw new Error('Faqat tasdiqlangan TEST endpoint ruxsat etiladi.');
  const schema = `browser_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Pool({ connectionString: raw, ssl: { rejectUnauthorized: false }, max: 1, application_name: 'dodola-browser-setup' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dodola-neon-browser-')), dataDir = path.join(root, 'data'), uploadsDir = path.join(root, 'uploads');
  fs.mkdirSync(dataDir); fs.mkdirSync(uploadsDir);
  for (const [name, value] of Object.entries({ products: [], orders: [], categories: ['Sinov'], promocodes: [], reviews: [], 'identifier-counters': {},
    'inventory-state': { applied: true, inventoryVersion: 1 }, customers: [], 'customer-sessions': {}, 'auth-tokens': [] })) fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(value));
  let pool, server, cleaned = false;
  async function cleanup() {
    if (cleaned) return; cleaned = true;
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await admin.end().catch(() => {}); fs.rmSync(root, { recursive: true, force: true });
  }
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: raw, ssl: { rejectUnauthorized: false }, max: 8, options: `-c search_path=${schema}`, application_name: 'dodola-browser-test' });
    await applySchema(pool);
    await pool.query(`INSERT INTO products (id,sku,name,description,category,price,inventory_mode,accepts_mto,primary_image,image_paths,legacy_payload,created_at,updated_at)
      VALUES ('browser-product','DOD-9910','Brauzer sinov mahsuloti','PostgreSQL route brauzer sinovi','Sinov',12500,'standard',false,'','[]','{}',now(),now())`);
    await pool.query(`INSERT INTO inventory_levels (product_id,available,reserved,sold,returned,low_stock_threshold,inventory_version)
      VALUES ('browser-product',5,0,0,0,5,1)`);
    process.env.JWT_SECRET = 'browser-test-jwt-secret-at-least-32-characters'; process.env.CUSTOMER_SESSION_SECRET = 'browser-test-session-secret-at-least-32';
    process.env.ADMIN_USERNAME = 'browser-test-admin'; process.env.ADMIN_PASSWORD = crypto.randomBytes(24).toString('hex'); process.env.NODE_ENV = 'test';
    const { createApp } = require('../../server');
    const app = createApp({ dataDir, uploadsDir, storageBackend: 'postgresql', postgresPool: pool,
      emailService: { baseUrl: 'http://127.0.0.1:3217', status: () => ({ configured: true, testMode: true }), send: async () => ({ accepted: true, id: 'browser-mock' }) } });
    server = app.listen(3217, '127.0.0.1', () => process.stdout.write('DODOLA_NEON_BROWSER_TEST_READY\n'));
    process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
    process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });
  } catch (error) { await cleanup(); throw error; }
}
main().catch(error => { process.stderr.write(JSON.stringify({ code: error.code || 'BROWSER_TEST_SERVER_FAILED', message: error.message }) + '\n'); process.exit(1); });
