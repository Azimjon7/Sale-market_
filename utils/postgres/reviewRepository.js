'use strict';
const crypto = require('crypto');
const json = value => JSON.stringify(value == null ? null : value);
const mapReview = row => row ? ({ ...(row.legacy_payload || {}), id: row.id, productId: row.source_product_id || row.product_id,
  name: row.customer_name, rating: Number(row.rating), review: row.review_text, customerId: row.customer_id || undefined,
  createdAt: row.created_at, updatedAt: row.updated_at || undefined }) : null;

class PostgresReviewRepository {
  constructor(pool) { this.pool = pool; }
  async list(productId = '') {
    const result = productId ? await this.pool.query('SELECT * FROM reviews WHERE source_product_id=$1 ORDER BY created_at DESC,id DESC', [productId])
      : await this.pool.query('SELECT * FROM reviews ORDER BY created_at DESC,id DESC');
    return result.rows.map(mapReview);
  }
  async countsByProduct() {
    const rows = (await this.pool.query('SELECT source_product_id,count(*) AS value FROM reviews GROUP BY source_product_id')).rows;
    return Object.fromEntries(rows.map(row => [row.source_product_id, Number(row.value)]));
  }
  async create(input) {
    const id = input.id || `rev_${crypto.randomUUID()}`, createdAt = input.createdAt || new Date().toISOString();
    const exists = (await this.pool.query('SELECT 1 FROM products WHERE id=$1 AND deleted_at IS NULL', [input.productId])).rowCount > 0;
    if (!exists) return null;
    const payload = { id, productId: input.productId, name: input.name, rating: input.rating, review: input.review, createdAt };
    const row = (await this.pool.query(`INSERT INTO reviews (id,product_id,source_product_id,customer_id,customer_name,rating,review_text,created_at,updated_at,legacy_payload)
      VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$7,$8) RETURNING *`, [id, input.productId, input.customerId || null, input.name,
      input.rating, input.review, createdAt, json(payload)])).rows[0];
    return mapReview(row);
  }
  async delete(id) { return (await this.pool.query('DELETE FROM reviews WHERE id=$1', [String(id)])).rowCount === 1; }
}
module.exports = { PostgresReviewRepository, mapReview };
