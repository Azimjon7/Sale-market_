'use strict';
const path = require('path');
const { loadSource, rowChecksum } = require('./sourceSnapshot');

const same = (a, b) => rowChecksum(a) === rowChecksum(b);
const normalizedVariants = product => [['color', product.colors], ['size', product.sizes]].flatMap(([type, raw]) => {
  const values = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
  return values.map((value, sourceIndex) => ({ type, sourceIndex, value: typeof value === 'object' ? String(value.name || value.value || '') : String(value), raw: value }));
});

async function verifyPreservation(pool, dataDir = path.join(__dirname, '..', '..', 'data')) {
  const source = loadSource(dataDir), checks = {};
  const products = (await pool.query('SELECT id,sku,legacy_payload FROM products ORDER BY id')).rows;
  const productSource = new Map(source.products.map(row => [String(row.id), row]));
  checks.products = { expected: source.products.length, actual: products.length, legacyMatched: products.filter(row => productSource.has(row.id) && same(row.legacy_payload, productSource.get(row.id))).length,
    skuMatched: products.filter(row => productSource.has(row.id) && row.sku === productSource.get(row.id).sku).length };

  const customers = (await pool.query('SELECT id,password_hash,legacy_payload FROM customers ORDER BY id')).rows;
  const customerSource = new Map(source.customers.map(row => [row.id, row]));
  checks.customers = { expected: source.customers.length, actual: customers.length, passwordHashesMatched: customers.filter(row => customerSource.has(row.id) && row.password_hash === customerSource.get(row.id).passwordHash).length,
    legacyMatched: customers.filter(row => customerSource.has(row.id) && same(row.legacy_payload, customerSource.get(row.id))).length };

  const tokens = (await pool.query('SELECT id,token_hash,legacy_payload FROM auth_tokens ORDER BY id')).rows;
  const tokenSource = new Map(source.tokens.map(row => [row.id, row]));
  checks.authTokens = { expected: source.tokens.length, actual: tokens.length, hashesMatched: tokens.filter(row => tokenSource.has(row.id) && row.token_hash === tokenSource.get(row.id).tokenHash).length,
    legacyMatched: tokens.filter(row => tokenSource.has(row.id) && same(row.legacy_payload, tokenSource.get(row.id))).length };

  const sessions = (await pool.query('SELECT sid,session_payload FROM customer_sessions ORDER BY sid')).rows;
  checks.sessions = { expected: Object.keys(source.sessions).length, actual: sessions.length, payloadsMatched: sessions.filter(row => source.sessions[row.sid] && same(row.session_payload, source.sessions[row.sid])).length };

  const orders = (await pool.query('SELECT id,public_order_number,guest_tracking_token_hash,legacy_payload FROM orders ORDER BY id')).rows;
  const orderSource = new Map(source.orders.map(row => [String(row.id), row]));
  checks.orders = { expected: source.orders.length, actual: orders.length, legacyMatched: orders.filter(row => orderSource.has(row.id) && same(row.legacy_payload, orderSource.get(row.id))).length,
    publicNumbersMatched: orders.filter(row => orderSource.has(row.id) && row.public_order_number === orderSource.get(row.id).orderNumber).length,
    guestHashesMatched: orders.filter(row => orderSource.has(row.id) && row.guest_tracking_token_hash === (orderSource.get(row.id).guestTrackingTokenHash || null)).length };

  const items = (await pool.query('SELECT order_id,source_index,source_product_id,product_id,legacy_payload FROM order_items ORDER BY order_id,source_index')).rows;
  const expectedItems = source.orders.flatMap(order => (order.items || []).map((item, index) => ({ orderId: String(order.id), index, item })));
  const expectedItemMap = new Map(expectedItems.map(row => [`${row.orderId}:${row.index}`, row.item]));
  const catalogIds = new Set(source.products.map(row => String(row.id)));
  checks.orderItems = { expected: expectedItems.length, actual: items.length,
    legacyMatched: items.filter(row => expectedItemMap.has(`${row.order_id}:${row.source_index}`) && same(row.legacy_payload, expectedItemMap.get(`${row.order_id}:${row.source_index}`))).length,
    sourceProductIdsMatched: items.filter(row => String(row.source_product_id || '') === String(expectedItemMap.get(`${row.order_id}:${row.source_index}`)?.productId || '')).length,
    preservedMissingCatalogReferences: items.filter(row => row.source_product_id && !catalogIds.has(String(row.source_product_id)) && row.product_id == null).length };

  const reservations = (await pool.query('SELECT order_id,source_index,legacy_payload FROM inventory_reservations ORDER BY order_id,source_index')).rows;
  const expectedReservations = source.orders.flatMap(order => (order.stockReservations || []).map((reservation, index) => ({ key: `${order.id}:${index}`, reservation })));
  const reservationMap = new Map(expectedReservations.map(row => [row.key, row.reservation]));
  checks.reservations = { expected: expectedReservations.length, actual: reservations.length,
    legacyMatched: reservations.filter(row => reservationMap.has(`${row.order_id}:${row.source_index}`) && same(row.legacy_payload, reservationMap.get(`${row.order_id}:${row.source_index}`))).length };

  const movements = (await pool.query('SELECT id,legacy_payload FROM inventory_movements ORDER BY id')).rows;
  const sourceMovements = new Map(source.products.flatMap(product => (product.stockHistory || []).map(movement => [movement.id, movement])));
  checks.movements = { expected: sourceMovements.size, actual: movements.length, legacyMatched: movements.filter(row => sourceMovements.has(row.id) && same(row.legacy_payload, sourceMovements.get(row.id))).length };

  const levels = (await pool.query('SELECT product_id,available,reserved,sold,returned FROM inventory_levels ORDER BY product_id')).rows;
  checks.inventory = { expectedProducts: source.products.length, actualProducts: levels.length,
    balancesMatched: levels.filter(row => { const item = productSource.get(row.product_id); return item && Number(row.available) === Number(item.available || 0) && Number(row.reserved) === Number(item.reserved || 0) && Number(row.sold) === Number(item.sold || 0) && Number(row.returned) === Number(item.returned || 0); }).length };

  const variants = (await pool.query('SELECT product_id,variant_type,value,source_index,legacy_payload FROM product_variants ORDER BY product_id,variant_type,source_index')).rows;
  const expectedVariants = source.products.flatMap(product => normalizedVariants(product).map(variant => ({ key: `${product.id}:${variant.type}:${variant.sourceIndex}`, ...variant })));
  const variantMap = new Map(expectedVariants.map(row => [row.key, row]));
  checks.variants = { expected: expectedVariants.length, actual: variants.length, matched: variants.filter(row => { const expected = variantMap.get(`${row.product_id}:${row.variant_type}:${row.source_index}`); return expected && row.value === expected.value && same(row.legacy_payload, expected.raw); }).length };

  const invalidConstraints = Number((await pool.query("SELECT count(*) AS count FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated")).rows[0].count);
  const checkpoints = Number((await pool.query('SELECT count(*) AS count FROM migration_checkpoints')).rows[0].count);
  checks.integrity = { invalidConstraints, checkpoints };
  const ok = Object.values(checks).every(group => Object.entries(group).every(([key, value]) => key === 'invalidConstraints' ? value === 0 : !key.startsWith('expected') || true))
    && checks.products.actual === checks.products.expected && checks.products.legacyMatched === checks.products.expected && checks.products.skuMatched === checks.products.expected
    && checks.customers.actual === checks.customers.expected && checks.customers.passwordHashesMatched === checks.customers.expected && checks.customers.legacyMatched === checks.customers.expected
    && checks.authTokens.actual === checks.authTokens.expected && checks.authTokens.hashesMatched === checks.authTokens.expected && checks.authTokens.legacyMatched === checks.authTokens.expected
    && checks.sessions.actual === checks.sessions.expected && checks.sessions.payloadsMatched === checks.sessions.expected
    && checks.orders.actual === checks.orders.expected && checks.orders.legacyMatched === checks.orders.expected && checks.orders.publicNumbersMatched === checks.orders.expected && checks.orders.guestHashesMatched === checks.orders.expected
    && checks.orderItems.actual === checks.orderItems.expected && checks.orderItems.legacyMatched === checks.orderItems.expected && checks.orderItems.sourceProductIdsMatched === checks.orderItems.expected
    && checks.reservations.actual === checks.reservations.expected && checks.reservations.legacyMatched === checks.reservations.expected
    && checks.movements.actual === checks.movements.expected && checks.movements.legacyMatched === checks.movements.expected
    && checks.inventory.actualProducts === checks.inventory.expectedProducts && checks.inventory.balancesMatched === checks.inventory.expectedProducts
    && checks.variants.actual === checks.variants.expected && checks.variants.matched === checks.variants.expected && invalidConstraints === 0;
  return { ok, checks };
}

module.exports = { verifyPreservation, normalizedVariants };
