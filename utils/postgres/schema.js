'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const migrationsDirectory = path.join(__dirname, '..', '..', 'db', 'migrations');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

async function applySchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = fs.readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), 'utf8');
    const version = file.replace(/\.sql$/, ''), checksum = sha256(sql);
    const existing = (await pool.query('SELECT checksum FROM schema_migrations WHERE version=$1', [version])).rows[0];
    if (existing) {
      if (existing.checksum !== checksum) throw Object.assign(new Error(`Sxema migratsiyasi o‘zgargan: ${version}`), { code: 'SCHEMA_CHECKSUM_MISMATCH' });
      continue;
    }
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2) ON CONFLICT (version) DO NOTHING', [version, checksum]);
  }
}

module.exports = { applySchema, sha256, migrationsDirectory };
