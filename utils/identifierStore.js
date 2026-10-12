const fs = require('fs');
const path = require('path');
const { readJSON, writeJSON } = require('./jsonStore');

const SKU_START = 1;
const ORDER_NUMBER_START = 1001;

function formatSku(value) {
  return `DOD-${String(value).padStart(4, '0')}`;
}

function formatOrderNumber(value) {
  return `DOD-ORD-${String(value).padStart(4, '0')}`;
}

function skuSequence(value) {
  const match = /^DOD-(\d{4,})$/i.exec(String(value || '').trim());
  return match ? Number(match[1]) : null;
}

function orderSequence(value) {
  const match = /^DOD-ORD-(\d{4,})$/i.exec(String(value || '').trim());
  return match ? Number(match[1]) : null;
}

function reconcileCounters(raw, products = [], orders = []) {
  const counters = raw && typeof raw === 'object' ? raw : {};
  const highestSku = products.reduce((max, product) => Math.max(max, skuSequence(product.sku) || 0), 0);
  const highestOrder = orders.reduce((max, order) => Math.max(max, orderSequence(order.orderNumber) || 0), 0);
  return {
    nextProductSku: Math.max(SKU_START, Number(counters.nextProductSku) || 0, highestSku + 1),
    nextOrderNumber: Math.max(ORDER_NUMBER_START, Number(counters.nextOrderNumber) || 0, highestOrder + 1),
    updatedAt: counters.updatedAt || null,
  };
}

function readCounters(filePath, products = [], orders = []) {
  return reconcileCounters(readJSON(filePath, {}), products, orders);
}

function writeCounters(filePath, counters) {
  writeJSON(filePath, { ...counters, updatedAt: new Date().toISOString() });
}

function allocateProductSku(counters, products = []) {
  const used = new Set(products.map(product => String(product.sku || '').toUpperCase()).filter(Boolean));
  let sequence = Math.max(SKU_START, Number(counters.nextProductSku) || SKU_START);
  let sku = formatSku(sequence);
  while (used.has(sku)) sku = formatSku(++sequence);
  counters.nextProductSku = sequence + 1;
  return sku;
}

function allocateOrderNumber(counters, orders = []) {
  const used = new Set(orders.map(order => String(order.orderNumber || '').toUpperCase()).filter(Boolean));
  let sequence = Math.max(ORDER_NUMBER_START, Number(counters.nextOrderNumber) || ORDER_NUMBER_START);
  let orderNumber = formatOrderNumber(sequence);
  while (used.has(orderNumber)) orderNumber = formatOrderNumber(++sequence);
  counters.nextOrderNumber = sequence + 1;
  return orderNumber;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withIdentifierLock(dataDir, task, options = {}) {
  const lockPath = path.join(dataDir, '.identifier-counters.lock');
  const attempts = options.attempts || 200;
  const retryMs = options.retryMs || 20;
  const staleMs = options.staleMs || 30000;
  fs.mkdirSync(dataDir, { recursive: true });

  let handle;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      handle = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) fs.unlinkSync(lockPath);
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      if (attempt === attempts - 1) throw Object.assign(new Error('Identifier allocation is busy'), { status: 503 });
      await wait(retryMs);
    }
  }

  try {
    return await task();
  } finally {
    try { if (handle !== undefined) fs.closeSync(handle); } catch {}
    try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

module.exports = {
  SKU_START,
  ORDER_NUMBER_START,
  formatSku,
  formatOrderNumber,
  skuSequence,
  orderSequence,
  reconcileCounters,
  readCounters,
  writeCounters,
  allocateProductSku,
  allocateOrderNumber,
  withIdentifierLock,
};
