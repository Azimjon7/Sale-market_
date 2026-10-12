'use strict';
const session = require('express-session');

class PostgresSessionStore extends session.Store {
  constructor(pool) { super(); this.pool = pool; }
  get(sid, callback) {
    this.pool.query('SELECT session_payload, expires_at FROM customer_sessions WHERE sid=$1 AND expires_at > now()', [sid])
      .then(({ rows }) => callback(null, rows[0] ? rows[0].session_payload : null), callback);
  }
  set(sid, value, callback = () => {}) {
    const expires = value.cookie && value.cookie.expires ? new Date(value.cookie.expires) : new Date(Date.now() + 86400000);
    this.pool.query(`INSERT INTO customer_sessions (sid,session_payload,customer_id,session_version,expires_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (sid) DO UPDATE SET session_payload=EXCLUDED.session_payload,
      customer_id=EXCLUDED.customer_id,session_version=EXCLUDED.session_version,expires_at=EXCLUDED.expires_at,updated_at=now()`,
    [sid, JSON.stringify(value), value.customerId || null, value.sessionVersion || null, expires]).then(() => callback(), callback);
  }
  destroy(sid, callback = () => {}) { this.pool.query('DELETE FROM customer_sessions WHERE sid=$1', [sid]).then(() => callback(), callback); }
  touch(sid, value, callback = () => {}) {
    const expires = value.cookie && value.cookie.expires ? new Date(value.cookie.expires) : new Date(Date.now() + 86400000);
    this.pool.query('UPDATE customer_sessions SET expires_at=$2,updated_at=now() WHERE sid=$1', [sid, expires]).then(() => callback(), callback);
  }
}

module.exports = { PostgresSessionStore };
