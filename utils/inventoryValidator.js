'use strict';

const INVENTORY_VERSION = 1;
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function isInventoryManaged(product) {
  return Boolean(product && product.inventoryManaged === true &&
    integer(product.inventoryVersion) === INVENTORY_VERSION);
}

function availableStock(product) {
  if (!product) return 0;
  if (isInventoryManaged(product)) return Math.max(0, integer(product.available));
  const value = product.stock;
  return value === undefined || value === null || value === '' ? 999 : Math.max(0, integer(value));
}

function lowStockThreshold(product) {
  return Math.max(0, integer(product && product.lowStockThreshold, DEFAULT_LOW_STOCK_THRESHOLD));
}

function validateProductStockForCheckout(product, qty) {
  if (!product) return { valid: false, error: 'Mahsulot topilmadi.' };
  if (!Number.isInteger(qty) || qty < 1) return { valid: false, error: "Mahsulot soni musbat butun son bo'lishi kerak." };
  if (!isInventoryManaged(product) && product._inventoryMode === 'made-to-order') return { valid: true };
  const available = availableStock(product);
  if (qty > available) return { valid: false, error: `Omborda faqat ${available} ta mavjud.` };
  const remaining = available - qty;
  return remaining <= lowStockThreshold(product)
    ? { valid: true, warning: `Omborda ${remaining} ta qoladi.` }
    : { valid: true };
}

function validateStockAllocation(product, items) {
  const totalQty = (Array.isArray(items) ? items : []).reduce((sum, item) => sum + integer(item && item.qty), 0);
  return validateProductStockForCheckout(product, totalQty);
}

module.exports = {
  INVENTORY_VERSION,
  DEFAULT_LOW_STOCK_THRESHOLD,
  integer,
  isInventoryManaged,
  availableStock,
  lowStockThreshold,
  validateProductStockForCheckout,
  validateStockAllocation,
};
