'use strict';
const { createPostgresPool, withTransaction } = require('../../utils/postgres/pool');

async function rollbackRun(pool, runId) {
  return withTransaction(pool, async client => {
      const run = (await client.query('SELECT status FROM migration_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0];
      if (!run) throw Object.assign(new Error('Migratsiya ishga tushirilgani topilmadi.'), { code: 'RUN_NOT_FOUND' });
      const expected = Object.fromEntries((await client.query('SELECT entity_type,count(*)::int AS count FROM migration_checkpoints WHERE run_id=$1 GROUP BY entity_type', [runId])).rows.map(row => [row.entity_type, Number(row.count)]));
      const protectedCounts = { product: 'products', customer: 'customers', order: 'orders', auth_token: 'auth_tokens',
        category: 'categories', promo_code: 'promo_codes', review: 'reviews' };
      for (const [type, table] of Object.entries(protectedCounts)) {
        const actual = Number((await client.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count);
        if (actual !== Number(expected[type] || 0)) throw Object.assign(new Error(`Rollback xavfsiz emas: ${table} jadvalida keyingi yozuvlar bor.`), { code: 'ROLLBACK_UNSAFE' });
      }
      if (Number((await client.query('SELECT count(*) AS count FROM promo_redemptions')).rows[0].count) !== 0)
        throw Object.assign(new Error('Rollback xavfsiz emas: promokod ishlatilgan.'), { code: 'ROLLBACK_UNSAFE' });
      for (const table of ['promo_redemptions','inventory_reservations','order_status_history','order_payments','order_items','orders','auth_tokens','customer_sessions','customer_addresses','customers','inventory_movements','inventory_levels','product_variants','reviews','products','promo_codes','categories','app_counters']) await client.query(`DELETE FROM ${table}`);
      await client.query('DELETE FROM migration_checkpoints WHERE run_id=$1', [runId]);
      await client.query("UPDATE migration_runs SET status='rolled_back',completed_at=now() WHERE id=$1", [runId]);
      return { ok: true, runId };
  });
}

async function main() {
  const runIdArg = process.argv.find(value => value.startsWith('--run-id='));
  if (!runIdArg || !process.argv.includes('--confirm=ROLLBACK_CONFIGURED_DATABASE') || process.env.ALLOW_POSTGRES_ROLLBACK !== 'yes')
    throw Object.assign(new Error('Rollback bloklandi: run ID va ikki bosqichli tasdiq talab qilinadi.'), { code: 'ROLLBACK_CONFIRMATION_REQUIRED' });
  const runId = runIdArg.slice(9), pool = createPostgresPool();
  try {
    await rollbackRun(pool, runId);
    process.stdout.write(`${JSON.stringify({ ok: true, runId })}\n`);
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'ROLLBACK_FAILED', message: error.message })}\n`); process.exitCode = 1; });
module.exports = { rollbackRun };
