'use strict';
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');
const { importSource } = require('./importer');
const { reconcile } = require('./reconcile');
const { rollbackRun } = require('./rollback-json-migration');

async function run() {
  const raw = String(process.env.DATABASE_URL || '').trim(), expectedHost = String(process.env.EXPECTED_NEON_TEST_HOST || '').trim().toLowerCase();
  if (!raw || !expectedHost) throw new Error('TEST ulanish muhiti sozlanmagan.');
  const parsed = new URL(raw);
  if (parsed.hostname.toLowerCase() !== expectedHost || !expectedHost.includes('ep-winter-wildflower-ban7x0vd'))
    throw Object.assign(new Error('Ulanish tasdiqlangan Neon TEST endpointiga tegishli emas.'), { code: 'TEST_ENDPOINT_MISMATCH' });
  const schema = `business_migration_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const admin = new Pool({ connectionString: raw, ssl: { rejectUnauthorized: false }, max: 1, application_name: 'dodola-business-migration-setup' });
  let pool;
  const report = { branchVerified: true, temporarySchemaCreated: false, temporarySchemaRemoved: false };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); report.temporarySchemaCreated = true;
    pool = new Pool({ connectionString: raw, ssl: { rejectUnauthorized: false }, max: 8,
      options: `-c search_path=${schema}`, application_name: 'dodola-business-migration-test' });
    const dataDir = path.join(__dirname, '..', '..', 'data');
    const first = await importSource(pool, dataDir);
    const firstCheckpoints = Number((await pool.query('SELECT count(*) AS value FROM migration_checkpoints WHERE run_id=$1', [first.runId])).rows[0].value);
    const second = await importSource(pool, dataDir);
    const secondCheckpoints = Number((await pool.query('SELECT count(*) AS value FROM migration_checkpoints WHERE run_id=$1', [first.runId])).rows[0].value);
    const reconciliation = await reconcile(pool, dataDir);
    const historicalReviewRefs = Number((await pool.query('SELECT count(*) AS value FROM reviews WHERE product_id IS NULL AND source_product_id IS NOT NULL')).rows[0].value);
    report.counts = reconciliation.actual;
    report.idempotent = first.runId === second.runId && firstCheckpoints === secondCheckpoints;
    report.reconciled = reconciliation.ok;
    report.historicalReviewReferences = historicalReviewRefs;
    await rollbackRun(pool, first.runId);
    report.rollback = Number((await pool.query('SELECT count(*) AS value FROM products')).rows[0].value) === 0 &&
      Number((await pool.query('SELECT count(*) AS value FROM categories')).rows[0].value) === 0 &&
      Number((await pool.query('SELECT count(*) AS value FROM promo_codes')).rows[0].value) === 0 &&
      Number((await pool.query('SELECT count(*) AS value FROM reviews')).rows[0].value) === 0;
    report.ok = report.idempotent && report.reconciled && report.rollback && historicalReviewRefs === 5;
    if (!report.ok) throw Object.assign(new Error('Neon biznes ma’lumotlari migratsiya tekshiruvi muvaffaqiyatsiz.'), { code: 'BUSINESS_MIGRATION_CHECK_FAILED' });
    return report;
  } finally {
    if (pool) await pool.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    report.temporarySchemaRemoved = true;
    await admin.end();
  }
}

if (require.main === module) run().then(report => process.stdout.write(JSON.stringify(report, null, 2) + '\n')).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'NEON_BUSINESS_MIGRATION_FAILED', message: error.message }) + '\n'); process.exitCode = 1;
});
module.exports = { run };
