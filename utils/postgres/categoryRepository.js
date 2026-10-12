'use strict';
const { withTransaction } = require('./pool');
const json = value => JSON.stringify(value == null ? null : value);

class PostgresCategoryRepository {
  constructor(pool) { this.pool = pool; }

  async list() {
    const result = await this.pool.query('SELECT name FROM categories ORDER BY source_index,id');
    return result.rows.map(row => row.name);
  }

  async create(name) {
    return withTransaction(this.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('dodola-categories'))");
      const existing = (await client.query('SELECT name FROM categories WHERE lower(name)=lower($1)', [name])).rows[0];
      if (!existing) {
        const sourceIndex = Number((await client.query('SELECT coalesce(max(source_index),-1)+1 AS value FROM categories')).rows[0].value);
        await client.query('INSERT INTO categories (source_index,name,legacy_payload) VALUES ($1,$2,$3)', [sourceIndex, name, json(name)]);
      }
      return (await client.query('SELECT name FROM categories ORDER BY source_index,id')).rows.map(row => row.name);
    });
  }

  async rename(currentName, nextName) {
    return withTransaction(this.pool, async client => {
      const current = (await client.query('SELECT id,name FROM categories WHERE lower(name)=lower($1) FOR UPDATE', [currentName])).rows[0];
      if (!current) return { found: false };
      const duplicate = (await client.query('SELECT 1 FROM categories WHERE lower(name)=lower($1) AND id<>$2', [nextName, current.id])).rowCount > 0;
      if (duplicate) return { found: true, duplicate: true };
      await client.query('UPDATE categories SET name=$2,legacy_payload=$3 WHERE id=$1', [current.id, nextName, json(nextName)]);
      const assigned = (await client.query('SELECT id,legacy_payload FROM products WHERE lower(category)=lower($1) FOR UPDATE', [current.name])).rows;
      for (const product of assigned) await client.query('UPDATE products SET category=$2,updated_at=now(),legacy_payload=$3 WHERE id=$1',
        [product.id, nextName, json({ ...(product.legacy_payload || {}), category: nextName })]);
      const categories = (await client.query('SELECT name FROM categories ORDER BY source_index,id')).rows.map(row => row.name);
      return { found: true, duplicate: false, categories };
    });
  }

  async delete(name) {
    return withTransaction(this.pool, async client => {
      const category = (await client.query('SELECT id,name FROM categories WHERE lower(name)=lower($1) FOR UPDATE', [name])).rows[0];
      if (!category) return { found: false };
      const assigned = Number((await client.query('SELECT count(*) AS value FROM products WHERE deleted_at IS NULL AND lower(category)=lower($1)', [category.name])).rows[0].value);
      if (assigned) return { found: true, assigned };
      await client.query('DELETE FROM categories WHERE id=$1', [category.id]);
      return { found: true, assigned: 0, categories: (await client.query('SELECT name FROM categories ORDER BY source_index,id')).rows.map(row => row.name) };
    });
  }
}
module.exports = { PostgresCategoryRepository };
