'use strict';
const path = require('path');
const { loadSource, validateSource, summarize, rowChecksum } = require('./sourceSnapshot');
const { applySchema } = require('../../utils/postgres/schema');
const { withTransaction } = require('../../utils/postgres/pool');

const j = value => value == null ? null : value;
const n = value => Number(value || 0);
const date = (value, fallback = null) => value || fallback;
const json = value => JSON.stringify(value == null ? null : value);

async function checkpoint(pool, runId, type, key, value, operation) {
  const checksum = rowChecksum(value);
  return withTransaction(pool, async client => {
    const existing = (await client.query('SELECT source_checksum FROM migration_checkpoints WHERE run_id=$1 AND entity_type=$2 AND source_key=$3', [runId, type, String(key)])).rows[0];
    if (existing) {
      if (existing.source_checksum !== checksum) throw Object.assign(new Error(`${type}/${key} manba xeshi o‘zgargan.`), { code: 'SOURCE_ROW_CHANGED' });
      return false;
    }
    await operation(client);
    await client.query('INSERT INTO migration_checkpoints (run_id,entity_type,source_key,source_checksum) VALUES ($1,$2,$3,$4)', [runId, type, String(key), checksum]);
    return true;
  });
}

async function checkpointBatches(pool, runId, type, rows, keyOf, valueOf, operation, batchSize = 100) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    await withTransaction(pool, async client => {
      for (const row of batch) {
        const key = String(keyOf(row)), value = valueOf(row), checksum = rowChecksum(value);
        const existing = (await client.query('SELECT source_checksum FROM migration_checkpoints WHERE run_id=$1 AND entity_type=$2 AND source_key=$3', [runId, type, key])).rows[0];
        if (existing) {
          if (existing.source_checksum !== checksum) throw Object.assign(new Error(`${type}/${key} manba xeshi o‘zgargan.`), { code: 'SOURCE_ROW_CHANGED' });
          continue;
        }
        await operation(client, row);
        await client.query('INSERT INTO migration_checkpoints (run_id,entity_type,source_key,source_checksum) VALUES ($1,$2,$3,$4)', [runId, type, key, checksum]);
      }
    });
  }
}

function valuesClause(rows, columns, mapRow) {
  const params = [];
  const sql = rows.map((row, rowIndex) => {
    const values = mapRow(row);
    if (values.length !== columns) throw new Error('Bulk import ustunlari mos emas.');
    params.push(...values);
    return `(${values.map((_, columnIndex) => `$${rowIndex * columns + columnIndex + 1}`).join(',')})`;
  }).join(',');
  return { sql, params };
}

async function checkpointBulkBatches(pool, runId, type, rows, keyOf, valueOf, bulkOperation, batchSize = 100) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    await withTransaction(pool, async client => {
      const keys = batch.map(row => String(keyOf(row)));
      const placeholders = keys.map((_, index) => `$${index + 2}`).join(',');
      const existingRows = (await client.query(`SELECT source_key,source_checksum FROM migration_checkpoints WHERE run_id=$1 AND entity_type=$${keys.length + 2} AND source_key IN (${placeholders})`, [runId, ...keys, type])).rows;
      const existing = new Map(existingRows.map(row => [row.source_key, row.source_checksum]));
      const missing = [];
      for (const row of batch) {
        const key = String(keyOf(row)), checksum = rowChecksum(valueOf(row));
        if (existing.has(key)) {
          if (existing.get(key) !== checksum) throw Object.assign(new Error(`${type}/${key} manba xeshi o‘zgargan.`), { code: 'SOURCE_ROW_CHANGED' });
        } else missing.push({ row, key, checksum });
      }
      if (!missing.length) return;
      await bulkOperation(client, missing.map(item => item.row));
      const checkpointValues = valuesClause(missing, 4, item => [runId, type, item.key, item.checksum]);
      await client.query(`INSERT INTO migration_checkpoints (run_id,entity_type,source_key,source_checksum) VALUES ${checkpointValues.sql}`, checkpointValues.params);
    });
  }
}

async function importSource(pool, dataDir = path.join(__dirname, '..', '..', 'data')) {
  const source = loadSource(dataDir), errors = validateSource(source), counts = summarize(source);
  if (errors.length) throw Object.assign(new Error('Manba tekshiruvidan o‘tmadi.'), { code: 'SOURCE_VALIDATION_FAILED', details: errors });
  await applySchema(pool);
  const productIds = new Set(source.products.map(row => String(row.id)));
  const runId = `json-${source.sourceChecksum.slice(0, 32)}`;
  await pool.query(`INSERT INTO migration_runs (id,source_checksum,status,source_counts) VALUES ($1,$2,'running',$3)
    ON CONFLICT (id) DO UPDATE SET status=CASE WHEN migration_runs.status='completed' THEN migration_runs.status ELSE 'running' END,
    source_counts=EXCLUDED.source_counts,completed_at=CASE WHEN migration_runs.status='completed' THEN migration_runs.completed_at ELSE NULL END,error_code=NULL`, [runId, source.sourceChecksum, json(counts)]);
  try {
    await checkpointBulkBatches(pool, runId, 'product', source.products, product => product.id, product => product, async (client, products) => {
      const productValues = valuesClause(products, 16, product => [String(product.id), product.sku, product.name || '', product.desc || '', product.category || null,
        n(product.price), product.oldPrice == null ? null : n(product.oldPrice), product._inventoryMode || 'standard', Boolean(product._acceptsMTO), product._productionDays == null ? null : n(product._productionDays),
        product.image || null, json(product.images || []), json(product.tags || []), json(product), date(product.createdAt), date(product.updatedAt)]);
      await client.query(`INSERT INTO products (id,sku,name,description,category,price,old_price,inventory_mode,accepts_mto,production_days,primary_image,image_paths,tags,legacy_payload,created_at,updated_at) VALUES ${productValues.sql}`, productValues.params);
      const variants = products.flatMap(product => [['color', product.colors], ['size', product.sizes]].flatMap(([variantType, rawValues]) => {
        const values = Array.isArray(rawValues) ? rawValues : rawValues == null || rawValues === '' ? [] : [rawValues];
        return values.map((value, sourceIndex) => ({ product, variantType, value, sourceIndex }));
      }));
      if (variants.length) {
        const variantValues = valuesClause(variants, 5, ({ product, variantType, value, sourceIndex }) => [String(product.id), variantType, typeof value === 'object' ? String(value.name || value.value || '') : String(value), sourceIndex, json(value)]);
        await client.query(`INSERT INTO product_variants (product_id,variant_type,value,source_index,legacy_payload) VALUES ${variantValues.sql}`, variantValues.params);
      }
      const inventoryValues = valuesClause(products, 8, product => [String(product.id), n(product.available), n(product.reserved), n(product.sold), n(product.returned), n(product.lowStockThreshold || 5), n(product.inventoryVersion || 1), date(product.inventoryInitializedAt)]);
      await client.query(`INSERT INTO inventory_levels (product_id,available,reserved,sold,returned,low_stock_threshold,inventory_version,initialized_at) VALUES ${inventoryValues.sql}`, inventoryValues.params);
    });
    for (const customer of source.customers) {
      await checkpoint(pool, runId, 'customer', customer.id, customer, async client => {
        await client.query(`INSERT INTO customers (id,first_name,last_name,phone,email,password_hash,phone_verified,email_verified_at,session_version,legacy_payload,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [customer.id, customer.firstName || '', customer.lastName || '', customer.phone, customer.email, customer.passwordHash,
          Boolean(customer.phoneVerified), date(customer.emailVerifiedAt), n(customer.sessionVersion || 1), json(customer), customer.createdAt, customer.updatedAt || customer.createdAt]);
        for (let i = 0; i < (customer.addresses || []).length; i += 1) { const address = customer.addresses[i]; await client.query(`INSERT INTO customer_addresses (id,customer_id,label,address,source_index,legacy_payload) VALUES ($1,$2,$3,$4,$5,$6)`,
          [address.id, customer.id, address.label || '', address.address || '', i, json(address)]); }
      });
    }
    for (const token of source.tokens) await checkpoint(pool, runId, 'auth_token', token.id, token, client => client.query(`INSERT INTO auth_tokens
      (id,customer_id,token_type,token_hash,expires_at,used_at,created_at,legacy_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [token.id, token.customerId, token.type, token.tokenHash, token.expiresAt, date(token.usedAt), token.createdAt, json(token)]));
    for (const [sid, session] of Object.entries(source.sessions || {})) await checkpoint(pool, runId, 'customer_session', sid, session, client => {
      const expires = session.cookie && session.cookie.expires ? session.cookie.expires : new Date(Date.now() + 86400000);
      return client.query(`INSERT INTO customer_sessions (sid,session_payload,customer_id,session_version,expires_at) VALUES ($1,$2,$3,$4,$5)`,
        [sid, json(session), session.customerId || null, session.sessionVersion || null, expires]);
    });
    for (const order of source.orders) {
      await checkpoint(pool, runId, 'order', order.id, order, async client => {
        await client.query(`INSERT INTO orders (id,public_order_number,customer_id,submission_token,guest_tracking_token_hash,customer_name,customer_phone,delivery_address,customer_note,
          subtotal,discount_amount,promo_code,total,status,payment_status,payment_type,payment_screenshot,payment_collected_at,payment_deadline,confirmed_at,rejected_at,rejection_reason,
          stock_committed,stock_restored,legacy_payload,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [order.id, order.orderNumber, order.customerId || null, order.submissionToken || null, order.guestTrackingTokenHash || null, order.name || '', order.phone || '', order.address || '', order.note || '',
          n(order.subtotal), n(order.discountAmount), order.promoCode || null, n(order.total), order.status, order.paymentStatus || 'pending', order.paymentType || null, order.paymentScreenshot || null,
          date(order.paymentCollectedAt), date(order.paymentDeadline), date(order.confirmedAt), date(order.rejectedAt), order.rejectionReason || null, Boolean(order.stockCommitted), Boolean(order.stockRestored), order,
          order.createdAt, order.updatedAt || order.createdAt].map((value, index) => index === 24 ? json(value) : value));
        for (let i = 0; i < (order.items || []).length; i += 1) { const item = order.items[i], sourceProductId = item.productId ? String(item.productId) : null; await client.query(`INSERT INTO order_items
          (order_id,product_id,source_product_id,source_index,sku,product_name,color,size,quantity,unit_price,inventory_mode,legacy_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [order.id, sourceProductId && productIds.has(sourceProductId) ? sourceProductId : null, sourceProductId, i, item.sku || null, item.name || item.productName || '', j(item.color), j(item.size), n(item.qty || item.quantity), n(item.price || item.unitPrice), item.inventoryMode || null, json(item)]); }
        for (let i = 0; i < (order.statusHistory || []).length; i += 1) { const entry = order.statusHistory[i]; await client.query(`INSERT INTO order_status_history
          (order_id,source_index,status,changed_by,reason,metadata,changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [order.id, i, entry.status, entry.changedBy || 'system', entry.reason || null, entry.metadata == null ? null : json(entry.metadata), entry.changedAt]); }
        await client.query(`INSERT INTO order_payments (order_id,method,status,provider_verified,collected_at,legacy_payload) VALUES ($1,$2,$3,false,$4,$5)`,
          [order.id, order.paymentType || null, order.paymentStatus || 'pending', date(order.paymentCollectedAt), json({ paymentScreenshot: order.paymentScreenshot || null })]);
        for (let i = 0; i < (order.stockReservations || []).length; i += 1) { const reservation = order.stockReservations[i]; await client.query(`INSERT INTO inventory_reservations
          (order_id,product_id,source_product_id,source_index,quantity,state,inventory_version,reserved_at,committed_at,restored_at,legacy_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [order.id, String(reservation.productId), String(reservation.productId), i, n(reservation.qty), reservation.state, n(reservation.inventoryVersion || 1), reservation.reservedAt || order.createdAt, date(reservation.committedAt), date(reservation.restoredAt), json(reservation)]); }
      });
    }
    const orderIds = new Set(source.orders.map(row => String(row.id)));
    const movements = source.products.flatMap(product => (product.stockHistory || []).map(movement => ({ product, movement })));
    await checkpointBulkBatches(pool, runId, 'inventory_movement', movements, row => row.movement.id, row => row.movement, async (client, rows) => {
      const movementValues = valuesClause(rows, 11, ({ product, movement }) => [movement.id, String(product.id), movement.orderId && orderIds.has(String(movement.orderId)) ? String(movement.orderId) : null,
        movement.type || 'legacy', n(movement.change), n(movement.oldBalance), n(movement.newBalance), movement.reason || null, movement.actor || 'system', movement.timestamp || new Date(0), json(movement)]);
      await client.query(`INSERT INTO inventory_movements (id,product_id,order_id,movement_type,quantity_change,old_balance,new_balance,reason,actor,occurred_at,legacy_payload) VALUES ${movementValues.sql}`, movementValues.params);
    });
    for (let i = 0; i < source.categories.length; i += 1) await checkpoint(pool, runId, 'category', i, source.categories[i], client => client.query('INSERT INTO categories (source_index,name,legacy_payload) VALUES ($1,$2,$3)', [i, String(source.categories[i]), json(source.categories[i])]));
    for (const promo of source.promoCodes) await checkpoint(pool, runId, 'promo_code', promo.code, promo, client => client.query('INSERT INTO promo_codes (code,discount_percent,created_at,legacy_payload) VALUES ($1,$2,$3,$4)', [promo.code, n(promo.discountPercent), date(promo.createdAt), json(promo)]));
    for (const review of source.reviews) await checkpoint(pool, runId, 'review', review.id, review, client => client.query('INSERT INTO reviews (id,product_id,source_product_id,customer_name,rating,review_text,created_at,legacy_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [review.id, review.productId && productIds.has(String(review.productId)) ? String(review.productId) : null, String(review.productId), review.name || null, n(review.rating), review.review || null, date(review.createdAt), json(review)]));
    await checkpoint(pool, runId, 'metadata', 'counters', source.counters, async client => {
      await client.query('INSERT INTO app_counters (name,next_value) VALUES ($1,$2),($3,$4)', ['nextProductSku', n(source.counters.nextProductSku), 'nextOrderNumber', n(source.counters.nextOrderNumber)]);
      await client.query("SELECT setval('product_sku_sequence',$1,false)", [n(source.counters.nextProductSku)]);
      await client.query("SELECT setval('public_order_sequence',$1,false)", [n(source.counters.nextOrderNumber)]);
    });
    await pool.query("UPDATE migration_runs SET status='completed',completed_at=now(),error_code=NULL WHERE id=$1", [runId]);
    return { runId, counts };
  } catch (error) {
    await pool.query("UPDATE migration_runs SET status='failed',error_code=$2 WHERE id=$1", [runId, error.code || 'IMPORT_FAILED']);
    throw error;
  }
}

module.exports = { importSource, checkpoint, checkpointBatches, checkpointBulkBatches, valuesClause };
