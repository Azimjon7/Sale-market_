'use strict';

class PostgresOrderReadRepository {
  constructor(pool) { this.pool = pool; }

  async #hydrate(rows) {
    for (const row of rows) {
      const items = await this.pool.query(`SELECT legacy_payload,coalesce(source_product_id,product_id) AS product_id,sku,product_name,color,size,
        quantity,unit_price,inventory_mode
        FROM order_items WHERE order_id=$1 ORDER BY source_index`, [row.id]);
      const history = await this.pool.query(`SELECT status,changed_by AS "changedBy",reason,changed_at AS "changedAt",metadata
        FROM order_status_history WHERE order_id=$1 ORDER BY source_index`, [row.id]);
      row.items = items.rows.map(item => ({ ...(item.legacy_payload || {}), productId: item.product_id, sku: item.sku,
        name: item.product_name, color: item.color, size: item.size, qty: Number(item.quantity), price: Number(item.unit_price), inventoryMode: item.inventory_mode }));
      row.statusHistory = history.rows;
    }
    return rows;
  }

  #select() {
    return `SELECT o.id,o.public_order_number AS "orderNumber",o.customer_id AS "customerId",o.customer_name AS name,
      o.customer_phone AS phone,o.delivery_address AS address,o.customer_note AS note,o.subtotal,o.discount_amount AS "discountAmount",
      o.promo_code AS "promoCode",o.total,o.status,o.payment_status AS "paymentStatus",o.payment_type AS "paymentType",
      o.payment_screenshot AS "paymentScreenshot",o.payment_deadline AS "paymentDeadline",o.payment_collected_at AS "paymentCollectedAt",
      o.confirmed_at AS "confirmedAt",o.rejected_at AS "rejectedAt",o.rejection_reason AS "rejectionReason",
      o.stock_committed AS "stockCommitted",o.stock_restored AS "stockRestored",o.guest_tracking_token_hash AS "guestTrackingTokenHash",
      o.submission_token AS "submissionToken",o.created_at AS "createdAt",o.updated_at AS "updatedAt" FROM orders o`;
  }

  async listOrders() { return this.#hydrate((await this.pool.query(`${this.#select()} ORDER BY o.created_at DESC,o.id DESC`)).rows); }
  async findById(id) { return (await this.#hydrate((await this.pool.query(`${this.#select()} WHERE o.id=$1`, [String(id)])).rows))[0] || null; }
  async findByNumber(number) { return (await this.#hydrate((await this.pool.query(`${this.#select()} WHERE upper(o.public_order_number)=upper($1)`, [String(number)])).rows))[0] || null; }
  async findBySubmissionToken(token) { return (await this.#hydrate((await this.pool.query(`${this.#select()} WHERE o.submission_token=$1`, [String(token)])).rows))[0] || null; }
}

module.exports = { PostgresOrderReadRepository };
