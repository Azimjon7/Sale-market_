'use strict';

const { isInventoryManaged, validateProductStockForCheckout } = require('./inventoryValidator');
const { reserveStock, commitReservedStock, restoreStock } = require('./stockReservation');

function cloneProducts(products) {
  return products.map(product => ({
    ...product,
    stockHistory: Array.isArray(product.stockHistory) ? product.stockHistory.map(entry => ({ ...entry })) : product.stockHistory,
  }));
}

function aggregateManagedQuantities(items, products) {
  const byId = new Map(products.map(product => [String(product.id), product]));
  const quantities = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const product = byId.get(String(item.productId));
    if (!product || !isInventoryManaged(product)) continue;
    quantities.set(String(product.id), (quantities.get(String(product.id)) || 0) + Number(item.qty || 0));
  }
  return quantities;
}

function validateOrderInventory(items, products) {
  const errors = [];
  const quantities = aggregateManagedQuantities(items, products);
  for (const [productId, qty] of quantities) {
    const product = products.find(row => String(row.id) === productId);
    const validation = validateProductStockForCheckout(product, qty);
    if (!validation.valid) errors.push({ field: 'items', productId, message: validation.error });
  }
  return { valid: errors.length === 0, errors, quantities };
}

function reserveOrderInventory(order, items, products) {
  const validation = validateOrderInventory(items, products);
  if (!validation.valid) {
    const error = new Error(validation.errors[0].message);
    error.code = 'INSUFFICIENT_STOCK';
    error.errors = validation.errors;
    throw error;
  }
  const updatedProducts = cloneProducts(products);
  const reservations = [];
  for (const [productId, qty] of validation.quantities) {
    const product = updatedProducts.find(row => String(row.id) === productId);
    reserveStock(product, qty, order.id);
    reservations.push({
      productId: product.id,
      qty,
      inventoryVersion: 1,
      state: 'reserved',
      reservedAt: new Date().toISOString(),
      committedAt: null,
      restoredAt: null,
    });
  }
  return { reservations, updatedProducts };
}

function managedReservations(order) {
  return (Array.isArray(order.stockReservations) ? order.stockReservations : [])
    .filter(item => Number(item.inventoryVersion) === 1);
}

function commitOrderInventory(order, products, actor) {
  const reservations = managedReservations(order);
  if (!reservations.length || order.stockCommitted) return { changed: false, updatedProducts: products };
  const updatedProducts = cloneProducts(products);
  const now = new Date().toISOString();
  for (const reservation of reservations) {
    if (reservation.state !== 'reserved') throw new Error('Ombor broni holati mos emas.');
    const product = updatedProducts.find(row => String(row.id) === String(reservation.productId));
    if (!product) throw new Error('Bronlangan mahsulot topilmadi.');
    commitReservedStock(product, reservation.qty, order.id, actor);
  }
  order.stockReservations = (order.stockReservations || []).map(item => Number(item.inventoryVersion) === 1
    ? { ...item, state: 'committed', committedAt: now } : item);
  order.stockCommitted = true;
  return { changed: true, updatedProducts };
}

function restoreOrderInventory(order, products, reason, actor) {
  const reservations = managedReservations(order);
  if (!reservations.length || order.stockRestored) return { changed: false, updatedProducts: products };
  const active = reservations.filter(item => item.state === 'reserved' || item.state === 'committed');
  if (!active.length) return { changed: false, updatedProducts: products };
  const updatedProducts = cloneProducts(products);
  const now = new Date().toISOString();
  for (const reservation of active) {
    const product = updatedProducts.find(row => String(row.id) === String(reservation.productId));
    if (!product) throw new Error('Bronlangan mahsulot topilmadi.');
    restoreStock(product, reservation.qty, order.id, reason, reservation.state === 'committed', actor);
  }
  order.stockReservations = (order.stockReservations || []).map(item =>
    Number(item.inventoryVersion) === 1 && (item.state === 'reserved' || item.state === 'committed')
      ? { ...item, state: 'restored', restoredAt: now } : item);
  order.stockRestored = true;
  return { changed: true, updatedProducts };
}

module.exports = {
  aggregateManagedQuantities,
  validateOrderInventory,
  reserveOrderInventory,
  commitOrderInventory,
  restoreOrderInventory,
  managedReservations,
};
