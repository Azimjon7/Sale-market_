'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { newDb, DataType } = require('pg-mem');
const { SOURCE_FILES } = require('../scripts/postgres/sourceSnapshot');
const { runDryRun } = require('../scripts/postgres/dry-run');
const { importSource } = require('../scripts/postgres/importer');
const { reconcile } = require('../scripts/postgres/reconcile');
const { applySchema } = require('../utils/postgres/schema');
const { PostgresOrderInventoryRepository } = require('../utils/postgres/orderInventoryRepository');
const { PostgresCatalogRepository } = require('../utils/postgres/catalogRepository');
const { PostgresCustomerRepository } = require('../utils/postgres/customerRepository');
const { rollbackRun } = require('../scripts/postgres/rollback-json-migration');

function memoryPool() {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerOperator({ operator: '~', left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (a, b) => new RegExp(b).test(a) });
  db.public.registerFunction({ name: 'setval', args: [DataType.text, DataType.integer, DataType.bool], returns: DataType.integer, implementation: (_sequence, value) => value });
  db.public.registerFunction({ name: 'hashtext', args: [DataType.text], returns: DataType.integer, implementation: value => value.length });
  db.public.registerFunction({ name: 'pg_advisory_xact_lock', args: [DataType.integer], returns: DataType.integer, implementation: () => 1 });
  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

function isolatedSource() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dodola-postgres-'));
  for (const file of SOURCE_FILES) fs.copyFileSync(path.join(__dirname, '..', 'data', file), path.join(directory, file));
  return directory;
}

test('dry-run validates the isolated JSON snapshot without connecting', () => {
  const directory = isolatedSource();
  try {
    const report = runDryRun(directory);
    assert.equal(report.ok, true);
    assert.equal(report.connectedToDatabase, false);
    assert.equal(report.summary.products, 1164);
    assert.equal(report.summary.uniqueSkus, 1164);
    assert.equal(report.summary.inventory.warehouseUnits, 17460);
    assert.equal(report.summary.inventory.accountedUnits, 17460);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('schema import is complete, reconcilable, and idempotently resumable', async () => {
  const directory = isolatedSource(), pool = memoryPool();
  try {
    const first = await importSource(pool, directory);
    const firstCheckpointCount = Number((await pool.query('SELECT count(*) AS count FROM migration_checkpoints WHERE run_id=$1', [first.runId])).rows[0].count);
    const second = await importSource(pool, directory);
    const secondCheckpointCount = Number((await pool.query('SELECT count(*) AS count FROM migration_checkpoints WHERE run_id=$1', [first.runId])).rows[0].count);
    assert.equal(second.runId, first.runId);
    assert.equal(secondCheckpointCount, firstCheckpointCount);
    const report = await reconcile(pool, directory);
    assert.equal(report.ok, true, JSON.stringify(report.mismatches));
    const rolledBack = await rollbackRun(pool, first.runId);
    assert.equal(rolledBack.ok, true);
    assert.equal(Number((await pool.query('SELECT count(*) AS value FROM categories')).rows[0].value), 0);
    assert.equal(Number((await pool.query('SELECT count(*) AS value FROM promo_codes')).rows[0].value), 0);
    assert.equal(Number((await pool.query('SELECT count(*) AS value FROM reviews')).rows[0].value), 0);
  } finally { await pool.end(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('transactional repository prevents duplicate orders and double settlement', async () => {
  const pool = memoryPool();
  try {
    await applySchema(pool);
    await pool.query(`INSERT INTO products (id,sku,name,price,legacy_payload) VALUES ('p1','DOD-9999','Sinov',1000,'{}')`);
    await pool.query(`INSERT INTO inventory_levels (product_id,available,reserved,sold,returned) VALUES ('p1',5,0,0,0)`);
    const repository = new PostgresOrderInventoryRepository(pool, { isolationLevel: null });
    const input = { submissionToken: 'once-only', items: [{ productId: 'p1', name: 'Sinov', qty: 2, price: 1000 }], name: 'Test', phone: '+998900000000', address: 'Test manzil', subtotal: 2000, total: 2000, status: 'payment_pending', paymentStatus: 'pending', paymentType: 'karta' };
    const first = await repository.placeOrder(input), duplicate = await repository.placeOrder(input);
    assert.equal(first.created, true); assert.equal(duplicate.created, false); assert.equal(duplicate.orderId, first.orderId);
    let stock = (await pool.query("SELECT available,reserved,sold FROM inventory_levels WHERE product_id='p1'")).rows[0];
    assert.deepEqual([Number(stock.available), Number(stock.reserved), Number(stock.sold)], [3, 2, 0]);
    await assert.rejects(repository.recordCashPayment(first.orderId, 'admin'), error => error.code === 'PROVIDER_VERIFICATION_REQUIRED');
    await assert.rejects(repository.recordProviderPayment({}), error => error.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED');
    assert.equal((await repository.commitReservation(first.orderId)).changed, true);
    assert.equal((await repository.commitReservation(first.orderId)).changed, false);
    stock = (await pool.query("SELECT available,reserved,sold FROM inventory_levels WHERE product_id='p1'")).rows[0];
    assert.deepEqual([Number(stock.available), Number(stock.reserved), Number(stock.sold)], [3, 0, 2]);
    assert.equal((await repository.releaseReservation(first.orderId)).changed, true);
    assert.equal((await repository.releaseReservation(first.orderId)).changed, false);
    stock = (await pool.query("SELECT available,reserved,sold,returned FROM inventory_levels WHERE product_id='p1'")).rows[0];
    assert.deepEqual([Number(stock.available), Number(stock.reserved), Number(stock.sold), Number(stock.returned)], [5, 0, 0, 2]);
  } finally { await pool.end(); }
});

test('PostgreSQL catalog allocates immutable, never-reused SKUs', async () => {
  const pool = memoryPool();
  try {
    await applySchema(pool);
    const catalog = new PostgresCatalogRepository(pool);
    const first = await catalog.createProduct({ name: 'Birinchi', price: 100, inventoryManaged: true, available: 5 });
    const originalSku = first.sku;
    const edited = await catalog.updateProduct(first.id, { name: 'Yangilangan', sku: 'DOD-0000', available: 999 });
    assert.equal(edited.sku, originalSku);
    assert.equal(await catalog.deleteProduct(first.id), true);
    const second = await catalog.createProduct({ name: 'Ikkinchi', price: 200 });
    assert.notEqual(second.sku, originalSku);
    assert.ok(Number(second.sku.slice(4)) > Number(originalSku.slice(4)));
  } finally { await pool.end(); }
});

test('PostgreSQL auth tokens remain hashed, expiring, and single-use', async () => {
  const pool = memoryPool();
  try {
    await applySchema(pool);
    const customers = new PostgresCustomerRepository(pool);
    const customer = await customers.createCustomer({ firstName: 'Test', lastName: 'Mijoz', phone: '+998900000001', email: 'test@example.invalid', passwordHash: '$2b$12$isolated.hash.value' });
    await customers.issueToken({ customerId: customer.id, type: 'verify_email', tokenHash: 'hashed-verification-token', expiresAt: new Date(Date.now() + 60000) });
    assert.equal(await customers.consumeEmailVerification('hashed-verification-token'), true);
    assert.equal(await customers.consumeEmailVerification('hashed-verification-token'), false);
    assert.ok((await customers.findById(customer.id)).email_verified_at);
    await customers.issueToken({ customerId: customer.id, type: 'reset_password', tokenHash: 'hashed-reset-token', expiresAt: new Date(Date.now() + 60000) });
    assert.equal(await customers.consumePasswordReset('hashed-reset-token', '$2b$12$new.isolated.hash'), true);
    assert.equal(await customers.consumePasswordReset('hashed-reset-token', '$2b$12$unused.hash'), false);
  } finally { await pool.end(); }
});

test('apply mode refuses to connect without both confirmation gates', () => {
  const result = spawnSync(process.execPath, ['scripts/postgres/migrate-json-to-postgres.js', '--apply'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, DATABASE_URL: '' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /IMPORT_CONFIRMATION_REQUIRED/);
});
