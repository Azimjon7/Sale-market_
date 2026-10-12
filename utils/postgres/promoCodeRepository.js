'use strict';
const { withTransaction } = require('./pool');
const json = value => JSON.stringify(value == null ? null : value);

function mapPromo(row) {
  if (!row) return null;
  return { ...(row.legacy_payload || {}), code: row.code, discountPercent: Number(row.discount_percent),
    createdAt: row.created_at, active: row.active, startsAt: row.starts_at, expiresAt: row.expires_at,
    usageLimit: row.usage_limit == null ? null : Number(row.usage_limit), redeemedCount: Number(row.redeemed_count || 0) };
}

class PostgresPromoCodeRepository {
  constructor(pool) { this.pool = pool; }
  async list() { return (await this.pool.query('SELECT * FROM promo_codes ORDER BY created_at,code')).rows.map(mapPromo); }
  async findValid(code, client = this.pool, options = {}) {
    const lock = options.lock ? ' FOR UPDATE' : '';
    const row = (await client.query(`SELECT * FROM promo_codes WHERE upper(code)=upper($1)${lock}`, [code])).rows[0];
    if (!row || !row.active) return null;
    const now = Date.now();
    if (row.starts_at && new Date(row.starts_at).getTime() > now) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) return null;
    if (row.usage_limit != null && Number(row.redeemed_count) >= Number(row.usage_limit)) return null;
    return mapPromo(row);
  }
  async upsert(input) {
    const payload = { code: input.code, discountPercent: Number(input.discountPercent), createdAt: input.createdAt || new Date().toISOString() };
    await this.pool.query(`INSERT INTO promo_codes (code,discount_percent,created_at,legacy_payload,active,starts_at,expires_at,usage_limit,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT (code) DO UPDATE SET discount_percent=EXCLUDED.discount_percent,
      active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,expires_at=EXCLUDED.expires_at,usage_limit=EXCLUDED.usage_limit,
      legacy_payload=promo_codes.legacy_payload || EXCLUDED.legacy_payload,updated_at=now()`, [input.code, input.discountPercent, payload.createdAt,
      json(payload), input.active !== false, input.startsAt || null, input.expiresAt || null, input.usageLimit || null]);
    return this.list();
  }
  async delete(code) {
    return withTransaction(this.pool, async client => {
      const row = (await client.query('SELECT code FROM promo_codes WHERE upper(code)=upper($1) FOR UPDATE', [code])).rows[0];
      if (!row) return { found: false };
      const used = Number((await client.query('SELECT count(*) AS value FROM promo_redemptions WHERE promo_code=$1', [row.code])).rows[0].value);
      if (used) return { found: true, used };
      await client.query('DELETE FROM promo_codes WHERE code=$1', [row.code]);
      return { found: true, used: 0, promocodes: (await client.query('SELECT * FROM promo_codes ORDER BY created_at,code')).rows.map(mapPromo) };
    });
  }
}
module.exports = { PostgresPromoCodeRepository, mapPromo };
