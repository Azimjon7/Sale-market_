'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJSON, writeJSON } = require('../utils/jsonStore');
const { initializeProductInventory } = require('../utils/stockReservation');
const { isInventoryManaged, INVENTORY_VERSION } = require('../utils/inventoryValidator');
const { withIdentifierLock } = require('../utils/identifierStore');

const STARTING_UNITS = 15;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildMigration(products, options = {}) {
  const timestamp = options.timestamp || new Date().toISOString();
  let initializedCount = 0;
  const migrated = products.map(product => {
    const result = initializeProductInventory(product, STARTING_UNITS, 'system', timestamp);
    if (result.initialized) initializedCount += 1;
    return result.product;
  });
  return {
    products: migrated,
    initializedCount,
    alreadyInitializedCount: products.length - initializedCount,
    productCount: migrated.length,
    startingUnits: STARTING_UNITS,
    totalStartingUnits: migrated.reduce((sum, product) => sum + (isInventoryManaged(product) ? STARTING_UNITS : 0), 0),
    timestamp,
  };
}

async function migrateWarehouseInventory(options) {
  if (!options || !options.dataDir) throw new Error('dataDir talab qilinadi.');
  const dataDir = path.resolve(options.dataDir);
  const productsFile = path.join(dataDir, 'products.json');
  const ordersFile = path.join(dataDir, 'orders.json');
  const stateFile = path.join(dataDir, 'inventory-state.json');
  const apply = options.apply === true;
  return withIdentifierLock(dataDir, async () => {
    const products = readJSON(productsFile, []);
    const ordersBefore = fs.existsSync(ordersFile) ? sha256(ordersFile) : null;
    const plan = buildMigration(products, options);
    const state = readJSON(stateFile, {});
    if (state.applied === true && plan.initializedCount > 0) {
      throw new Error('Ombor migratsiyasi avval yakunlangan, lekin boshqarilmaydigan mahsulot topildi.');
    }
    const needsStateRecovery = apply && state.applied !== true && plan.productCount > 0 &&
      plan.products.every(isInventoryManaged);
    if (apply && (plan.initializedCount > 0 || needsStateRecovery)) {
      const backupDir = options.backupDir || path.join(dataDir, 'backups', 'warehouse-inventory-' + plan.timestamp.replace(/[:.]/g, '-'));
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(productsFile, path.join(backupDir, 'products.json'));
      if (fs.existsSync(ordersFile)) fs.copyFileSync(ordersFile, path.join(backupDir, 'orders.json'));
      if (plan.initializedCount > 0) writeJSON(productsFile, plan.products);
      writeJSON(stateFile, {
        applied: true,
        inventoryVersion: INVENTORY_VERSION,
        appliedAt: plan.timestamp,
        startingUnits: STARTING_UNITS,
        productCount: plan.productCount,
        totalStartingUnits: plan.totalStartingUnits,
        productsBeforeHash: sha256(path.join(backupDir, 'products.json')),
        ordersHash: ordersBefore,
      });
      if (ordersBefore && sha256(ordersFile) !== ordersBefore) throw new Error('Tarixiy buyurtmalar migratsiya vaqtida o‘zgardi.');
      plan.backupDir = backupDir;
    }
    return { ...plan, applied: apply && (plan.initializedCount > 0 || needsStateRecovery) };
  });
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const dataArg = process.argv.find(value => value.startsWith('--data-dir='));
  const dataDir = dataArg ? dataArg.slice('--data-dir='.length) : path.join(__dirname, '..', 'data');
  migrateWarehouseInventory({ dataDir, apply }).then(result => {
    console.log(JSON.stringify({ applied: result.applied, initializedCount: result.initializedCount,
      alreadyInitializedCount: result.alreadyInitializedCount, productCount: result.productCount,
      startingUnits: result.startingUnits, totalStartingUnits: result.totalStartingUnits,
      backupDir: result.backupDir || null }, null, 2));
    if (!apply) console.log("Quruq tekshiruv yakunlandi. Haqiqiy yozish uchun foydalanuvchi tasdig'idan keyin --apply ishlatiladi.");
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { STARTING_UNITS, buildMigration, migrateWarehouseInventory };
