const fs = require('fs');
const path = require('path');
const { readJSON, writeJSON } = require('../utils/jsonStore');
const {
  SKU_START,
  ORDER_NUMBER_START,
  formatSku,
  formatOrderNumber,
  skuSequence,
  orderSequence,
  reconcileCounters,
  writeCounters,
  withIdentifierLock,
} = require('../utils/identifierStore');

function assertUniqueIdentifiers(records, field, parser) {
  const seen = new Set();
  for (const record of records) {
    if (!record[field]) continue;
    const value = String(record[field]).trim().toUpperCase();
    if (!parser(value)) throw new Error(`Invalid ${field} found; migration stopped without changes.`);
    if (seen.has(value)) throw new Error(`Duplicate ${field} found; migration stopped without changes.`);
    seen.add(value);
  }
  return seen;
}

function assignProductSkus(products) {
  const used = assertUniqueIdentifiers(products, 'sku', skuSequence);
  let next = Math.max(SKU_START, ...Array.from(used, sku => skuSequence(sku) + 1));
  let assigned = 0;
  const migrated = products.map(product => {
    if (product.sku) return product;
    let sku = formatSku(next++);
    while (used.has(sku)) sku = formatSku(next++);
    used.add(sku);
    assigned += 1;
    return { ...product, sku };
  });
  return { records: migrated, assigned };
}

function assignOrderNumbers(orders) {
  const used = assertUniqueIdentifiers(orders, 'orderNumber', orderSequence);
  let next = Math.max(ORDER_NUMBER_START, ...Array.from(used, value => orderSequence(value) + 1));
  let assigned = 0;
  const migrated = orders.map(order => ({ ...order }));
  const indexes = migrated.map((order, index) => ({ index, time: new Date(order.createdAt || 0).getTime() || 0 }))
    .sort((a, b) => a.time - b.time || a.index - b.index);

  for (const { index } of indexes) {
    if (migrated[index].orderNumber) continue;
    let orderNumber = formatOrderNumber(next++);
    while (used.has(orderNumber)) orderNumber = formatOrderNumber(next++);
    used.add(orderNumber);
    migrated[index].orderNumber = orderNumber;
    assigned += 1;
  }
  return { records: migrated, assigned };
}

function backupData(projectRoot, dataDir, files) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(projectRoot, '.local-backups', `identifier-migration-${stamp}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const file of files) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
  }
  return backupDir;
}

async function migrateIdentifiers({ projectRoot = path.join(__dirname, '..'), dataDir = path.join(projectRoot, 'data'), dryRun = false } = {}) {
  const productsFile = path.join(dataDir, 'products.json');
  const ordersFile = path.join(dataDir, 'orders.json');
  const countersFile = path.join(dataDir, 'identifier-counters.json');

  return withIdentifierLock(dataDir, async () => {
    const products = readJSON(productsFile, []);
    const orders = readJSON(ordersFile, []);
    if (!Array.isArray(products) || !Array.isArray(orders)) throw new Error('Products and orders must be arrays.');

    const productResult = assignProductSkus(products);
    const orderResult = assignOrderNumbers(orders);
    const counters = reconcileCounters(readJSON(countersFile, {}), productResult.records, orderResult.records);
    const changed = productResult.assigned > 0 || orderResult.assigned > 0 || !fs.existsSync(countersFile);
    let backupDir = null;

    if (changed && !dryRun) {
      backupDir = backupData(projectRoot, dataDir, [productsFile, ordersFile, countersFile]);
      writeJSON(productsFile, productResult.records);
      writeJSON(ordersFile, orderResult.records);
      writeCounters(countersFile, counters);
    }

    return {
      products: productResult.records.length,
      orders: orderResult.records.length,
      productSkusAssigned: productResult.assigned,
      orderNumbersAssigned: orderResult.assigned,
      nextProductSku: counters.nextProductSku,
      nextOrderNumber: counters.nextOrderNumber,
      changed,
      dryRun,
      backupDir,
    };
  });
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  migrateIdentifiers({ dryRun }).then(result => {
    console.log(JSON.stringify(result));
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrateIdentifiers, assignProductSkus, assignOrderNumbers };
