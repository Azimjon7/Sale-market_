'use strict';

function postgresConfig(env = process.env) {
  const connectionString = String(env.DATABASE_URL || '').trim();
  if (!connectionString) throw Object.assign(new Error('DATABASE_URL sozlanmagan.'), { code: 'DATABASE_NOT_CONFIGURED' });
  const sslMode = String(env.DATABASE_SSL_MODE || 'require').toLowerCase();
  if (!['require', 'verify-full', 'disable'].includes(sslMode)) throw new Error('DATABASE_SSL_MODE qiymati yaroqsiz.');
  return {
    connectionString,
    ssl: sslMode === 'disable' ? false : { rejectUnauthorized: sslMode === 'verify-full' },
    max: Number(env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: Number(env.DATABASE_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(env.DATABASE_CONNECT_TIMEOUT_MS || 10000),
    application_name: 'dodola-server'
  };
}

function redactDatabaseError(error) {
  const safe = new Error('PostgreSQL amali bajarilmadi.');
  safe.code = error && error.code ? error.code : 'DATABASE_ERROR';
  return safe;
}

module.exports = { postgresConfig, redactDatabaseError };
