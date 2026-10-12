'use strict';
const { Pool } = require('pg');
const { postgresConfig } = require('./config');

function createPostgresPool(env = process.env) {
  return new Pool(postgresConfig(env));
}

async function withTransaction(pool, operation, options = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (options.isolationLevel) await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* retain original failure */ }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createPostgresPool, withTransaction };
