'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

process.env.NODE_ENV = 'production';
process.env.PUBLIC_WRITES_ENABLED = 'false';
process.env.JWT_SECRET = 'synthetic-jwt-secret-that-is-long-enough';
process.env.CUSTOMER_SESSION_SECRET = 'synthetic-session-secret-that-is-long-enough';
process.env.ADMIN_USERNAME = 'synthetic-admin';
process.env.ADMIN_PASSWORD = 'synthetic-admin-password';

const { createApp } = require('../server');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dodola-launch-lock-'));
  const dataDir = path.join(root, 'data');
  const uploadsDir = path.join(root, 'uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  const files = {
    'products.json': [], 'orders.json': [], 'customers.json': [],
    'customer-sessions.json': {}, 'auth-tokens.json': [],
    'identifier-counters.json': { nextProductSku: 1, nextOrderNumber: 1001 },
    'inventory-state.json': {}, 'categories.json': [], 'promocodes.json': [], 'reviews.json': [],
  };
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value));
  }
  return { root, dataDir, uploadsDir };
}

test('production launch lock blocks customer writes but permits health and admin login', async t => {
  const dirs = fixture();
  t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));
  const app = createApp({ ...dirs, notifyOrder: async () => {} });

  const health = await request(app).get('/api/health').expect(200);
  assert.equal(health.body.publicWritesEnabled, false);
  await request(app).post('/api/orders').send({}).expect(503, {
    success: false,
    code: 'PUBLIC_LAUNCH_LOCKED',
    message: 'Sayt ishga tushirishga tayyorlanmoqda. Bu amal hozircha yopiq.',
  });
  await request(app).post('/api/auth/register').send({}).expect(503);
  await request(app).post('/api/reviews').send({}).expect(503);
  const login = await request(app).post('/api/admin/login').send({
    username: 'synthetic-admin', password: 'synthetic-admin-password',
  }).expect(200);
  assert.equal(login.body.success, true);
});
