'use strict';
const path = require('path');
const { loadSource, summarize } = require('./sourceSnapshot');

async function reconcile(pool, dataDir = path.join(__dirname, '..', '..', 'data')) {
  const expected = summarize(loadSource(dataDir));
  const scalar = async sql => Number((await pool.query(sql)).rows[0].value);
  const actual = {
    products: await scalar('SELECT count(*) AS value FROM products'),
    uniqueProductIds: await scalar('SELECT count(DISTINCT id) AS value FROM products'),
    uniqueSkus: await scalar('SELECT count(DISTINCT sku) AS value FROM products'),
    productVariants: await scalar('SELECT count(*) AS value FROM product_variants'),
    inventoryMovements: await scalar('SELECT count(*) AS value FROM inventory_movements'),
    customers: await scalar('SELECT count(*) AS value FROM customers'),
    addresses: await scalar('SELECT count(*) AS value FROM customer_addresses'),
    customerSessions: await scalar('SELECT count(*) AS value FROM customer_sessions'),
    authTokens: await scalar('SELECT count(*) AS value FROM auth_tokens'),
    orders: await scalar('SELECT count(*) AS value FROM orders'),
    uniqueOrderNumbers: await scalar('SELECT count(DISTINCT public_order_number) AS value FROM orders'),
    orderItems: await scalar('SELECT count(*) AS value FROM order_items'),
    inventoryReservations: await scalar('SELECT count(*) AS value FROM inventory_reservations'),
    guestTrackingHashes: await scalar('SELECT count(*) AS value FROM orders WHERE guest_tracking_token_hash IS NOT NULL'),
    categories: await scalar('SELECT count(*) AS value FROM categories'),
    categoryProductAssignments: await scalar('SELECT count(*) AS value FROM products WHERE category IS NOT NULL'),
    unmatchedCategoryAssignments: await scalar(`SELECT count(*) AS value FROM products p
      LEFT JOIN categories c ON lower(c.name)=lower(p.category) WHERE p.category IS NOT NULL AND c.id IS NULL`),
    promoCodes: await scalar('SELECT count(*) AS value FROM promo_codes'),
    promoRedemptions: await scalar('SELECT count(*) AS value FROM promo_redemptions'),
    reviews: await scalar('SELECT count(*) AS value FROM reviews'),
    historicalReviewProductReferences: await scalar('SELECT count(*) AS value FROM reviews WHERE product_id IS NULL AND source_product_id IS NOT NULL')
  };
  const inventory = (await pool.query(`SELECT count(*) FILTER (WHERE inventory_version > 0) AS managed_products,
    coalesce(sum(available),0) AS available,coalesce(sum(reserved),0) AS reserved,coalesce(sum(sold),0) AS sold,coalesce(sum(returned),0) AS returned FROM inventory_levels`)).rows[0];
  actual.inventory = { managedProducts: Number(inventory.managed_products), available: Number(inventory.available), reserved: Number(inventory.reserved), sold: Number(inventory.sold), returned: Number(inventory.returned) };
  actual.inventory.warehouseUnits = actual.inventory.available + actual.inventory.reserved;
  actual.inventory.accountedUnits = actual.inventory.available + actual.inventory.reserved + actual.inventory.sold;
  const mismatches = [];
  for (const key of Object.keys(actual)) {
    if (key === 'inventory') continue;
    if (actual[key] !== expected[key]) mismatches.push({ field: key, expected: expected[key], actual: actual[key] });
  }
  for (const key of Object.keys(actual.inventory)) if (actual.inventory[key] !== expected.inventory[key]) mismatches.push({ field: `inventory.${key}`, expected: expected.inventory[key], actual: actual.inventory[key] });
  return { ok: mismatches.length === 0, expected, actual, mismatches };
}
module.exports = { reconcile };
