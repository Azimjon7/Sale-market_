'use strict';

const { randomUUID } = require('crypto');
const { integer, isInventoryManaged, DEFAULT_LOW_STOCK_THRESHOLD, INVENTORY_VERSION } = require('./inventoryValidator');

function movement(product, data) {
  const entry = Object.freeze({
    id: 'mov_' + randomUUID(),
    timestamp: data.timestamp || new Date().toISOString(),
    productId: product.id,
    orderId: data.orderId || null,
    type: data.type,
    change: data.change,
    oldBalance: data.oldBalance,
    newBalance: data.newBalance,
    reason: data.reason,
    actor: data.actor || 'system',
  });
  product.stockHistory = [...(Array.isArray(product.stockHistory) ? product.stockHistory : []), entry];
  return entry;
}

function assertManaged(product) {
  if (!product) throw new Error('Mahsulot topilmadi.');
  if (!isInventoryManaged(product)) throw new Error('Mahsulot ombor hisobiga kiritilmagan.');
}

function assertQty(qty) {
  if (!Number.isInteger(qty) || qty < 1) throw new Error("Mahsulot soni musbat butun son bo'lishi kerak.");
}

function syncAvailable(product, value) {
  product.available = value;
  product.stock = value;
}

function initializeProductInventory(product, startingUnits = 15, actor = 'system', timestamp = new Date().toISOString()) {
  if (!product || typeof product !== 'object') throw new Error('Mahsulot topilmadi.');
  if (isInventoryManaged(product)) return { product, initialized: false };
  startingUnits = integer(startingUnits, -1);
  if (startingUnits < 0) throw new Error("Boshlang'ich qoldiq manfiy bo'lishi mumkin emas.");
  const initialized = {
    ...product,
    inventoryManaged: true,
    inventoryVersion: INVENTORY_VERSION,
    inventoryInitializedAt: timestamp,
    stock: startingUnits,
    available: startingUnits,
    reserved: 0,
    sold: 0,
    returned: 0,
    lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
    stockHistory: Array.isArray(product.stockHistory) ? [...product.stockHistory] : [],
  };
  movement(initialized, {
    type: 'initial_setup', change: startingUnits, oldBalance: 0, newBalance: startingUnits,
    reason: `Boshlang'ich ombor qoldig'i: ${startingUnits} ta`, actor, timestamp,
  });
  return { product: initialized, initialized: true };
}

function reserveStock(product, qty, orderId) {
  assertManaged(product); assertQty(qty);
  const available = integer(product.available);
  if (qty > available) throw new Error(`Omborda faqat ${available} ta mavjud.`);
  const next = available - qty;
  syncAvailable(product, next);
  product.reserved = integer(product.reserved) + qty;
  const entry = movement(product, {
    type: 'order_reserved', change: -qty, oldBalance: available, newBalance: next,
    reason: `Buyurtma uchun ${qty} ta bronlandi`, actor: 'system', orderId,
  });
  return { success: true, newAvailable: next, movement: entry };
}

function commitReservedStock(product, qty, orderId, actor = 'system') {
  assertManaged(product); assertQty(qty);
  const reserved = integer(product.reserved);
  if (qty > reserved) throw new Error(`Bronlangan qoldiq yetarli emas: ${reserved} ta.`);
  product.reserved = reserved - qty;
  product.sold = integer(product.sold) + qty;
  const balance = integer(product.available);
  const entry = movement(product, {
    type: 'order_committed', change: 0, oldBalance: balance, newBalance: balance,
    reason: `Buyurtma bo'yicha ${qty} ta sotuvga o'tkazildi`, actor, orderId,
  });
  return { success: true, newAvailable: balance, movement: entry };
}

function restoreStock(product, qty, orderId, reason, isCommitted, actor = 'system') {
  assertManaged(product); assertQty(qty);
  if (isCommitted) {
    const sold = integer(product.sold);
    if (qty > sold) throw new Error(`Sotilgan qoldiq yetarli emas: ${sold} ta.`);
    product.sold = sold - qty;
    product.returned = integer(product.returned) + qty;
  } else {
    const reserved = integer(product.reserved);
    if (qty > reserved) throw new Error(`Bronlangan qoldiq yetarli emas: ${reserved} ta.`);
    product.reserved = reserved - qty;
  }
  const oldBalance = integer(product.available);
  const next = oldBalance + qty;
  syncAvailable(product, next);
  const entry = movement(product, {
    type: 'order_restored', change: qty, oldBalance, newBalance: next,
    reason: reason || `Buyurtmadan ${qty} ta omborga qaytarildi`, actor, orderId,
  });
  return { success: true, newAvailable: next, movement: entry };
}

function adjustStockManually(product, change, reason, admin) {
  assertManaged(product);
  if (!Number.isInteger(change) || change === 0) throw new Error("O'zgarish noldan farqli butun son bo'lishi kerak.");
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 3 || cleanReason.length > 500) throw new Error("O'zgartirish sababini 3–500 belgi oralig'ida kiriting.");
  const oldBalance = integer(product.available);
  const next = oldBalance + change;
  if (next < 0) throw new Error(`Qoldiq manfiy bo'lishi mumkin emas. Hozir: ${oldBalance} ta.`);
  syncAvailable(product, next);
  const entry = movement(product, {
    type: 'admin_adjustment', change, oldBalance, newBalance: next,
    reason: cleanReason, actor: admin || 'admin',
  });
  return { success: true, newAvailable: next, movement: entry };
}

module.exports = {
  initializeProductInventory,
  reserveStock,
  commitReservedStock,
  restoreStock,
  adjustStockManually,
};
