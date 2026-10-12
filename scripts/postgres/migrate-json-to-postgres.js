'use strict';
const path = require('path');
const { runDryRun } = require('./dry-run');
const { importSource } = require('./importer');
const { createPostgresPool } = require('../../utils/postgres/pool');

const args = new Set(process.argv.slice(2));
const dataArg = process.argv.find(value => value.startsWith('--data-dir='));
const dataDir = dataArg ? path.resolve(dataArg.slice(11)) : path.join(__dirname, '..', '..', 'data');

async function main() {
  if (!args.has('--apply')) {
    const report = runDryRun(dataDir); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = report.ok ? 0 : 1; return;
  }
  if (!args.has('--confirm=IMPORT_TO_CONFIGURED_DATABASE')) throw Object.assign(new Error('Import bloklandi: aniq tasdiq bayrog‘i yo‘q.'), { code: 'IMPORT_CONFIRMATION_REQUIRED' });
  if (process.env.ALLOW_POSTGRES_IMPORT !== 'yes') throw Object.assign(new Error('Import bloklandi: ALLOW_POSTGRES_IMPORT=yes talab qilinadi.'), { code: 'IMPORT_ENV_CONFIRMATION_REQUIRED' });
  const pool = createPostgresPool();
  try { const result = await importSource(pool, dataDir); process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`); }
  finally { await pool.end(); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'MIGRATION_FAILED', message: error.message })}\n`); process.exitCode = 1; });
