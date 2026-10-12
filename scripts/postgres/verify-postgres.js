'use strict';
const path = require('path');
const { createPostgresPool } = require('../../utils/postgres/pool');
const { verifyPreservation } = require('./verify-preservation');
const dataArg = process.argv.find(value => value.startsWith('--data-dir='));
const dataDir = dataArg ? path.resolve(dataArg.slice(11)) : path.join(__dirname, '..', '..', 'data');
async function main() { const pool = createPostgresPool(); try { const result = await verifyPreservation(pool, dataDir); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.ok ? 0 : 1; } finally { await pool.end(); } }
if (require.main === module) main().catch(error => { process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'VERIFICATION_FAILED', message: error.message })}\n`); process.exitCode = 1; });
