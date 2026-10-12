'use strict';
const crypto = require('crypto');
const { withTransaction } = require('./pool');

const ORDER_STATUSES = new Set(['pending_confirmation','confirmed','payment_pending','production','shipped','delivered','rejected','cancelled']);
const PAYMENT_STATUSES = new Set(['pending','collected','failed']);
const asMoney = value => Number(value || 0);
const positiveInteger = value => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const json = value => JSON.stringify(value == null ? null : value);
const TRANSITIONS = {
  pending_confirmation: new Set(['confirmed','rejected','cancelled']),
  confirmed: new Set(['payment_pending','cancelled','rejected']),
  payment_pending: new Set(['production','cancelled','rejected']),
  production: new Set(['shipped']), shipped: new Set(['delivered']), delivered: new Set(), rejected: new Set(), cancelled: new Set()
};

class PostgresOrderInventoryRepository {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.transactionOptions = { isolationLevel: options.isolationLevel === undefined ? 'SERIALIZABLE' : options.isolationLevel };
    this.verifyProviderEvent = options.verifyProviderEvent || null;
  }

  async recordCashPayment(orderId, actor) {
    return withTransaction(this.pool, async client => {
      const payment = (await client.query(`SELECT orders.payment_type,order_payments.status FROM orders JOIN order_payments ON order_payments.order_id=orders.id
        WHERE orders.id=$1 FOR UPDATE`, [orderId])).rows[0];
      if (!payment) throw Object.assign(new Error('Buyurtma topilmadi.'), { code: 'ORDER_NOT_FOUND' });
      if (payment.payment_type === 'karta') throw Object.assign(new Error('Onlayn to‘lovni faqat provayder tasdiqlaydi.'), { code: 'PROVIDER_VERIFICATION_REQUIRED' });
      if (payment.status === 'collected') return { changed: false };
      await client.query("UPDATE order_payments SET status='collected',collected_at=now() WHERE order_id=$1", [orderId]);
      await client.query("UPDATE orders SET payment_status='collected',payment_collected_at=now(),updated_at=now() WHERE id=$1", [orderId]);
      await client.query(`INSERT INTO order_status_history (order_id,source_index,status,changed_by,reason,changed_at)
        SELECT $1,coalesce(max(source_index),-1)+1,orders.status,$2,'Naqd to‘lov qabul qilindi',now() FROM orders
        LEFT JOIN order_status_history ON order_status_history.order_id=orders.id WHERE orders.id=$1 GROUP BY orders.status`, [orderId, actor || 'admin']);
      return { changed: true };
    });
  }

  async recordProviderPayment(event) {
    if (!this.verifyProviderEvent) throw Object.assign(new Error('To‘lov provayderi tekshiruvchisi sozlanmagan.'), { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });
    const verified = await this.verifyProviderEvent(event);
    if (!verified || !verified.orderId || !verified.reference) throw Object.assign(new Error('Provayder tasdig‘i yaroqsiz.'), { code: 'PAYMENT_PROVIDER_REJECTED' });
    return withTransaction(this.pool, async client => {
      const payment = (await client.query(`SELECT orders.payment_type,order_payments.status,order_payments.provider_reference FROM orders
        JOIN order_payments ON order_payments.order_id=orders.id WHERE orders.id=$1 FOR UPDATE`, [verified.orderId])).rows[0];
      if (!payment || payment.payment_type !== 'karta') throw Object.assign(new Error('Onlayn to‘lov buyurtmasi topilmadi.'), { code: 'ONLINE_ORDER_NOT_FOUND' });
      if (payment.status === 'collected') return { changed: false };
      await client.query(`UPDATE order_payments SET status='collected',provider_verified=true,provider_reference=$2,collected_at=now() WHERE order_id=$1`, [verified.orderId, verified.reference]);
      await client.query("UPDATE orders SET payment_status='collected',payment_collected_at=now(),updated_at=now() WHERE id=$1", [verified.orderId]);
      return { changed: true };
    });
  }

  async transitionOrder(orderId, target, options = {}) {
    if (!ORDER_STATUSES.has(target)) throw Object.assign(new Error('Buyurtma holati yaroqsiz.'), { code: 'INVALID_STATUS' });
    const actor = String(options.actor || 'admin'), reason = String(options.reason || '').trim();
    return withTransaction(this.pool, async client => {
      const order = (await client.query(`SELECT id,status,payment_status,payment_type,stock_committed,stock_restored
        FROM orders WHERE id=$1 FOR UPDATE`, [String(orderId)])).rows[0];
      if (!order) throw Object.assign(new Error('Buyurtma topilmadi.'), { code: 'ORDER_NOT_FOUND' });
      if (order.status === target) return { changed: false };
      const validPaymentTransition = options.collectPayment && target === 'production' && ['confirmed','payment_pending'].includes(order.status);
      if (!validPaymentTransition && (!TRANSITIONS[order.status] || !TRANSITIONS[order.status].has(target))) {
        throw Object.assign(new Error(`Holatni ${order.status} dan ${target} ga o‘tkazib bo‘lmaydi.`), { code: 'INVALID_TRANSITION' });
      }
      if (target === 'rejected' && !reason) throw Object.assign(new Error('Rad etish sababi talab qilinadi.'), { code: 'REJECTION_REASON_REQUIRED' });
      let paymentStatus = order.payment_status;
      if (options.collectPayment) {
        if (order.payment_type === 'karta') throw Object.assign(new Error('Onlayn to‘lovni faqat provayder tasdiqlaydi.'), { code: 'PROVIDER_VERIFICATION_REQUIRED' });
        paymentStatus = 'collected';
        await client.query(`UPDATE order_payments SET status='collected',collected_at=coalesce(collected_at,now()) WHERE order_id=$1`, [orderId]);
      }
      if (target === 'production' && paymentStatus !== 'collected') throw Object.assign(new Error('Avval to‘lovni tasdiqlang.'), { code: 'PAYMENT_REQUIRED' });

      if (target === 'confirmed' || options.collectPayment) await this.#settleWithClient(client, orderId, 'commit', actor, 'Buyurtma tasdiqlandi');
      if (target === 'rejected' || target === 'cancelled') await this.#settleWithClient(client, orderId, 'release', actor, reason || 'Buyurtma bekor qilindi');

      const historyIndex = Number((await client.query('SELECT coalesce(max(source_index),-1)+1 AS value FROM order_status_history WHERE order_id=$1', [orderId])).rows[0].value);
      await client.query(`UPDATE orders SET status=$2,payment_status=$3,payment_collected_at=CASE WHEN $3='collected' THEN coalesce(payment_collected_at,now()) ELSE payment_collected_at END,
        confirmed_at=CASE WHEN $2='confirmed' THEN coalesce(confirmed_at,now()) ELSE confirmed_at END,
        rejected_at=CASE WHEN $2='rejected' THEN now() ELSE rejected_at END,rejection_reason=CASE WHEN $2='rejected' THEN $4 ELSE rejection_reason END,updated_at=now()
        WHERE id=$1`, [orderId, target, paymentStatus, reason || null]);
      await client.query(`INSERT INTO order_status_history (order_id,source_index,status,changed_by,reason,changed_at)
        VALUES ($1,$2,$3,$4,$5,now())`, [orderId, historyIndex, target, actor, reason || (options.collectPayment ? 'Naqd to‘lov qabul qilindi' : 'Holat yangilandi')]);
      return { changed: true };
    }, this.transactionOptions);
  }

  async placeOrder(input) {
    if (!input || !input.submissionToken || !Array.isArray(input.items) || !input.items.length) throw new Error('Buyurtma ma’lumotlari to‘liq emas.');
    if (!ORDER_STATUSES.has(input.status) || !PAYMENT_STATUSES.has(input.paymentStatus)) throw new Error('Buyurtma holati yaroqsiz.');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await withTransaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.submissionToken]);
      const existing = await client.query('SELECT id,public_order_number FROM orders WHERE submission_token=$1', [input.submissionToken]);
      if (existing.rows[0]) return { created: false, orderId: existing.rows[0].id, orderNumber: existing.rows[0].public_order_number };

      const quantities = new Map();
      for (const item of input.items) {
        const qty = positiveInteger(item.qty || item.quantity);
        if (!qty || !item.productId) throw new Error('Mahsulot soni yaroqsiz.');
        quantities.set(String(item.productId), (quantities.get(String(item.productId)) || 0) + qty);
      }
      const productIds = [...quantities.keys()].sort();
      const placeholders = productIds.map((_, index) => `$${index + 1}`).join(',');
      const locked = await client.query(`SELECT product_id,available FROM inventory_levels WHERE product_id IN (${placeholders}) ORDER BY product_id FOR UPDATE`, productIds);
      if (locked.rows.length !== productIds.length) throw Object.assign(new Error('Ombor ma’lumoti topilmadi.'), { code: 'INVENTORY_NOT_FOUND' });
      for (const row of locked.rows) if (quantities.get(row.product_id) > Number(row.available)) throw Object.assign(new Error('Omborda yetarli mahsulot yo‘q.'), { code: 'INSUFFICIENT_STOCK' });

      let promoCode = String(input.promoCode || '').trim().toUpperCase() || null;
      let discountAmount = 0;
      const subtotal = asMoney(input.subtotal);
      if (promoCode) {
        const promo = (await client.query('SELECT * FROM promo_codes WHERE upper(code)=upper($1) FOR UPDATE', [promoCode])).rows[0];
        const now = Date.now();
        const unavailable = !promo || !promo.active || (promo.starts_at && new Date(promo.starts_at).getTime() > now) ||
          (promo.expires_at && new Date(promo.expires_at).getTime() <= now) ||
          (promo.usage_limit != null && Number(promo.redeemed_count) >= Number(promo.usage_limit));
        if (unavailable) throw Object.assign(new Error('Promokod topilmadi yoki amal qilish muddati tugagan.'), { code: 'PROMO_NOT_AVAILABLE' });
        promoCode = promo.code;
        discountAmount = Math.floor((subtotal * Number(promo.discount_percent)) / 100);
      }
      const total = Math.max(0, subtotal - discountAmount);
      if (!(total > 0)) throw Object.assign(new Error('Buyurtma summasi musbat bo‘lishi kerak.'), { code: 'INVALID_TOTAL' });

      const orderId = input.id || `ord_${crypto.randomUUID()}`;
      const seq = await client.query("SELECT nextval('public_order_sequence') AS value");
      const orderNumber = `DOD-ORD-${String(seq.rows[0].value).padStart(4, '0')}`;
      await client.query(`INSERT INTO orders (id,public_order_number,customer_id,submission_token,guest_tracking_token_hash,
        customer_name,customer_phone,delivery_address,customer_note,subtotal,discount_amount,promo_code,total,status,payment_status,
        payment_type,payment_screenshot,payment_deadline,stock_committed,stock_restored,legacy_payload,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,false,false,$19,$20,$20)`,
      [orderId, orderNumber, input.customerId || null, input.submissionToken, input.guestTrackingTokenHash || null,
        input.name, input.phone, input.address, input.note || '', subtotal, discountAmount, promoCode,
        total, input.status, input.paymentStatus, input.paymentType || null, input.paymentScreenshot || null,
        input.paymentDeadline || null, json({ ...(input.legacyPayload || input), discountAmount, promoCode, total }), input.createdAt || new Date()]);

      if (promoCode) {
        const redeemed = await client.query(`UPDATE promo_codes SET redeemed_count=redeemed_count+1,updated_at=now()
          WHERE code=$1 AND active=true AND (starts_at IS NULL OR starts_at<=now()) AND (expires_at IS NULL OR expires_at>now())
          AND (usage_limit IS NULL OR redeemed_count<usage_limit) RETURNING code`, [promoCode]);
        if (!redeemed.rowCount) throw Object.assign(new Error('Promokod limiti tugagan.'), { code: 'PROMO_NOT_AVAILABLE' });
        await client.query(`INSERT INTO promo_redemptions (promo_code,order_id,customer_id,discount_amount)
          VALUES ($1,$2,$3,$4)`, [promoCode, orderId, input.customerId || null, discountAmount]);
      }

      for (let i = 0; i < input.items.length; i += 1) {
        const item = input.items[i], qty = positiveInteger(item.qty || item.quantity);
        await client.query(`INSERT INTO order_items (order_id,product_id,source_product_id,source_index,sku,product_name,color,size,quantity,unit_price,inventory_mode,legacy_payload)
          VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [orderId, String(item.productId), i, item.sku || null,
          item.name || item.productName || '', item.color || null, item.size || null, qty, asMoney(item.price || item.unitPrice), item.inventoryMode || null, json(item)]);
      }
      await client.query('INSERT INTO order_payments (order_id,method,status,provider_verified,legacy_payload) VALUES ($1,$2,$3,false,$4)',
        [orderId, input.paymentType || null, input.paymentStatus, json(input.payment || {})]);
      await client.query(`INSERT INTO order_status_history (order_id,source_index,status,changed_by,reason,changed_at)
        VALUES ($1,0,$2,'system',$3,$4)`, [orderId, input.status, input.statusReason || 'Buyurtma yaratildi', input.createdAt || new Date()]);

      let reservationIndex = 0;
      for (const productId of productIds) {
        const qty = quantities.get(productId);
        const updated = await client.query(`UPDATE inventory_levels SET available=available-($2::integer),reserved=reserved+($2::integer),updated_at=now()
          WHERE product_id=$1 AND available >= ($2::integer) RETURNING available`, [productId, qty]);
        if (!updated.rows[0]) throw Object.assign(new Error('Omborda yetarli mahsulot yo‘q.'), { code: 'INSUFFICIENT_STOCK' });
        await client.query(`INSERT INTO inventory_reservations (order_id,product_id,source_product_id,source_index,quantity,state,reserved_at,legacy_payload)
          VALUES ($1,$2,$2,$3,$4,'reserved',now(),$5)`, [orderId, productId, reservationIndex, qty, json({ inventoryVersion: 1 })]);
        await client.query(`INSERT INTO inventory_movements (id,product_id,order_id,movement_type,quantity_change,old_balance,new_balance,reason,actor,occurred_at,legacy_payload)
          VALUES ($1,$2,$3,'order_reserved',$4,$5,$6,$7,'system',now(),$8)`, [`mov_${crypto.randomUUID()}`, productId, orderId, -qty,
          Number(updated.rows[0].available) + qty, Number(updated.rows[0].available), `Buyurtma uchun ${qty} ta bronlandi`, json({})]);
        reservationIndex += 1;
      }
          return { created: true, orderId, orderNumber };
        }, this.transactionOptions);
      } catch (error) {
        if (!['40001', '40P01'].includes(error.code) || attempt === 2) throw error;
      }
    }
    throw new Error('Buyurtma tranzaksiyasi yakunlanmadi.');
  }

  async commitReservation(orderId, actor = 'system') {
    return this.#settleReservation(orderId, 'commit', actor, 'To‘lov tasdiqlandi');
  }

  async releaseReservation(orderId, actor = 'system', reason = 'Buyurtma bekor qilindi') {
    return this.#settleReservation(orderId, 'release', actor, reason);
  }

  async deleteOrder(orderId) {
    return withTransaction(this.pool, async client => {
      const order = (await client.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [String(orderId)])).rows[0];
      if (!order) return { found: false, deleted: false };
      const active = await client.query(`SELECT 1 FROM inventory_reservations WHERE order_id=$1 LIMIT 1`, [orderId]);
      if (active.rowCount) return { found: true, deleted: false };
      await client.query('DELETE FROM orders WHERE id=$1', [orderId]);
      return { found: true, deleted: true };
    });
  }

  async #settleReservation(orderId, action, actor, reason) {
    return withTransaction(this.pool, async client => {
      const orderResult = await client.query('SELECT id,stock_committed,stock_restored FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (!orderResult.rows[0]) throw Object.assign(new Error('Buyurtma topilmadi.'), { code: 'ORDER_NOT_FOUND' });
      const changed = await this.#settleWithClient(client, orderId, action, actor, reason);
      return { changed };
    });
  }

  async #settleWithClient(client, orderId, action, actor, reason) {
      const reservations = await client.query(`SELECT id,product_id,quantity,state FROM inventory_reservations
        WHERE order_id=$1 ORDER BY product_id,id FOR UPDATE`, [orderId]);
      const active = reservations.rows.filter(row => action === 'commit' ? row.state === 'reserved' : ['reserved','committed'].includes(row.state));
      if (!active.length) return false;
      for (const reservation of active) {
        const level = await client.query('SELECT available,reserved,sold,returned FROM inventory_levels WHERE product_id=$1 FOR UPDATE', [reservation.product_id]);
        if (!level.rows[0]) throw new Error('Ombor ma’lumoti topilmadi.');
        const qty = Number(reservation.quantity), before = Number(level.rows[0].available);
        if (action === 'commit') {
          const result = await client.query('UPDATE inventory_levels SET reserved=reserved-($2::integer),sold=sold+($2::integer),updated_at=now() WHERE product_id=$1 AND reserved >= ($2::integer)', [reservation.product_id, qty]);
          if (!result.rowCount) throw new Error('Bronlangan qoldiq yetarli emas.');
          await client.query("UPDATE inventory_reservations SET state='committed',committed_at=now() WHERE id=$1 AND state='reserved'", [reservation.id]);
        } else if (reservation.state === 'reserved') {
          await client.query('UPDATE inventory_levels SET available=available+($2::integer),reserved=reserved-($2::integer),updated_at=now() WHERE product_id=$1 AND reserved >= ($2::integer)', [reservation.product_id, qty]);
          await client.query("UPDATE inventory_reservations SET state='released',restored_at=now() WHERE id=$1 AND state='reserved'", [reservation.id]);
        } else {
          await client.query('UPDATE inventory_levels SET available=available+($2::integer),sold=sold-($2::integer),returned=returned+($2::integer),updated_at=now() WHERE product_id=$1 AND sold >= ($2::integer)', [reservation.product_id, qty]);
          await client.query("UPDATE inventory_reservations SET state='restored',restored_at=now() WHERE id=$1 AND state='committed'", [reservation.id]);
        }
        const after = action === 'commit' ? before : before + qty;
        await client.query(`INSERT INTO inventory_movements (id,product_id,order_id,movement_type,quantity_change,old_balance,new_balance,reason,actor,occurred_at,legacy_payload)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)`, [`mov_${crypto.randomUUID()}`, reservation.product_id, orderId,
          action === 'commit' ? 'order_committed' : 'order_restored', action === 'commit' ? 0 : qty, before, after, reason, actor, json({})]);
      }
      await client.query(action === 'commit' ? 'UPDATE orders SET stock_committed=true,updated_at=now() WHERE id=$1' : 'UPDATE orders SET stock_restored=true,updated_at=now() WHERE id=$1', [orderId]);
      return true;
  }
}

module.exports = { PostgresOrderInventoryRepository, ORDER_STATUSES, PAYMENT_STATUSES };
