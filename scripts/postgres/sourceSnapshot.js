'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCE_FILES = ['products.json','orders.json','customers.json','customer-sessions.json','auth-tokens.json','identifier-counters.json','inventory-state.json','categories.json','promocodes.json','reviews.json'];
const canonicalize = value => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])])) : value;
const canonical = value => JSON.stringify(canonicalize(value));
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const read = (dir, file, fallback) => { const filePath = path.join(dir, file); return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback; };

function loadSource(dataDir) {
  const raw = {};
  for (const file of SOURCE_FILES) raw[file] = fs.existsSync(path.join(dataDir, file)) ? fs.readFileSync(path.join(dataDir, file), 'utf8') : '';
  const source = {
    products: read(dataDir, 'products.json', []), orders: read(dataDir, 'orders.json', []), customers: read(dataDir, 'customers.json', []),
    sessions: read(dataDir, 'customer-sessions.json', {}), tokens: read(dataDir, 'auth-tokens.json', []), counters: read(dataDir, 'identifier-counters.json', {}),
    inventoryState: read(dataDir, 'inventory-state.json', {}), categories: read(dataDir, 'categories.json', []), promoCodes: read(dataDir, 'promocodes.json', []),
    reviews: read(dataDir, 'reviews.json', [])
  };
  source.sourceChecksum = hash(SOURCE_FILES.map(file => `${file}:${hash(raw[file])}`).join('\n'));
  return source;
}

function validateSource(source) {
  const errors = [], seen = (rows, key, label) => {
    const values = rows.map(row => String(row[key] || ''));
    if (values.some(value => !value)) errors.push(`${label}: bo‘sh qiymat bor.`);
    if (new Set(values).size !== values.length) errors.push(`${label}: takroriy qiymat bor.`);
  };
  seen(source.products, 'id', 'Mahsulot ID'); seen(source.products, 'sku', 'SKU'); seen(source.orders, 'id', 'Buyurtma ID'); seen(source.orders, 'orderNumber', 'Buyurtma raqami'); seen(source.customers, 'id', 'Mijoz ID');
  seen(source.promoCodes, 'code', 'Promokod'); seen(source.reviews, 'id', 'Sharh ID');
  const categoryNames = source.categories.map(value => String(value || '').trim().toLocaleLowerCase('uz'));
  if (categoryNames.some(value => !value)) errors.push('Kategoriya: bo‘sh nom bor.');
  if (new Set(categoryNames).size !== categoryNames.length) errors.push('Kategoriya: takroriy nom bor.');
  const productIds = new Set(source.products.map(row => String(row.id))), customerIds = new Set(source.customers.map(row => String(row.id)));
  for (const order of source.orders) {
    if (order.customerId && !customerIds.has(String(order.customerId))) errors.push(`Buyurtma ${order.id}: mijoz topilmadi.`);
    for (const reservation of order.stockReservations || []) if (!productIds.has(String(reservation.productId))) errors.push(`Buyurtma ${order.id}: faol ombor broni mahsuloti ${reservation.productId} topilmadi.`);
  }
  for (const token of source.tokens) if (!customerIds.has(String(token.customerId))) errors.push(`Token ${token.id}: mijoz topilmadi.`);
  for (const product of source.products) {
    for (const field of ['available','reserved','sold','returned']) if (Number(product[field] || 0) < 0) errors.push(`${product.id}: ${field} manfiy.`);
  }
  return errors;
}

function summarize(source) {
  const sum = key => source.products.reduce((total, row) => total + Number(row[key] || 0), 0);
  const variantCount = value => Array.isArray(value) ? value.length : value == null || value === '' ? 0 : 1;
  const productIds = new Set(source.products.map(row => String(row.id)));
  const categoryNames = new Set(source.categories.map(value => String(value || '').trim().toLocaleLowerCase('uz')));
  return {
    products: source.products.length,
    uniqueProductIds: new Set(source.products.map(row => String(row.id))).size,
    uniqueSkus: new Set(source.products.map(row => row.sku)).size,
    productVariants: source.products.reduce((n, row) => n + variantCount(row.colors) + variantCount(row.sizes), 0),
    inventory: { managedProducts: source.products.filter(row => row.inventoryManaged).length, available: sum('available'), reserved: sum('reserved'), sold: sum('sold'), returned: sum('returned'), warehouseUnits: sum('available') + sum('reserved'), accountedUnits: sum('available') + sum('reserved') + sum('sold') },
    inventoryMovements: source.products.reduce((n, row) => n + (row.stockHistory || []).length, 0),
    customers: source.customers.length, addresses: source.customers.reduce((n, row) => n + (row.addresses || []).length, 0),
    customerSessions: Object.keys(source.sessions || {}).length, authTokens: source.tokens.length,
    orders: source.orders.length, uniqueOrderNumbers: new Set(source.orders.map(row => row.orderNumber)).size,
    orderItems: source.orders.reduce((n, row) => n + (row.items || []).length, 0),
    historicalOrderItemReferences: source.orders.reduce((n, row) => n + (row.items || []).filter(item => item.productId && !new Set(source.products.map(product => String(product.id))).has(String(item.productId))).length, 0),
    inventoryReservations: source.orders.reduce((n, row) => n + (row.stockReservations || []).length, 0),
    guestTrackingHashes: source.orders.filter(row => row.guestTrackingTokenHash).length,
    categories: source.categories.length,
    categoryProductAssignments: source.products.filter(row => row.category).length,
    unmatchedCategoryAssignments: source.products.filter(row => row.category && !categoryNames.has(String(row.category).trim().toLocaleLowerCase('uz'))).length,
    promoCodes: source.promoCodes.length, promoRedemptions: 0, reviews: source.reviews.length,
    historicalReviewProductReferences: source.reviews.filter(row => row.productId && !productIds.has(String(row.productId))).length,
    sourceChecksum: source.sourceChecksum
  };
}

function rowChecksum(value) { return hash(canonical(value)); }
module.exports = { SOURCE_FILES, loadSource, validateSource, summarize, rowChecksum, hash };
