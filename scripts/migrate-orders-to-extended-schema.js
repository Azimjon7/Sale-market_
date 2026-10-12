#!/usr/bin/env node

/**
 * Migrate existing orders to extended schema with status and payment tracking
 * 
 * This script:
 * 1. Backs up existing data/orders.json
 * 2. Updates all orders to include new fields:
 *    - paymentStatus (enum: pending, collected, failed)
 *    - paymentCollectedAt (ISO timestamp or null)
 *    - status (extended enum)
 *    - statusHistory (immutable audit trail)
 *    - confirmedAt, rejectedAt, rejectionReason
 *    - paymentDeadline (created + 7 days)
 *    - items[].inventoryMode and items[].estimatedProduction
 * 3. Preserves all existing data and metadata
 * 4. Is idempotent (safe to run multiple times)
 */

const fs = require('fs');
const path = require('path');

// Order status constants
const OrderStatus = {
  PENDING_CONFIRMATION: 'pending_confirmation',
  CONFIRMED: 'confirmed',
  PAYMENT_PENDING: 'payment_pending',
  PRODUCTION: 'production',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
};

const PaymentStatus = {
  PENDING: 'pending',
  COLLECTED: 'collected',
  FAILED: 'failed'
};

// Paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// Ensure directory exists
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Read JSON file
function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
    return [];
  }
}

// Write JSON file
function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err.message);
    return false;
  }
}

// Create backup
function createBackup(filePath, operation) {
  try {
    ensureDir(BACKUPS_DIR);
    const timestamp = Date.now();
    const basename = path.basename(filePath, '.json');
    const backupName = `${basename}-before-${operation}-${timestamp}.json`;
    const backupPath = path.join(BACKUPS_DIR, backupName);
    
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
      console.log(`✓ Backup created: ${backupName}`);
      return backupPath;
    }
  } catch (err) {
    console.error(`Error creating backup:`, err.message);
  }
  return null;
}

// Prune old backups (keep last N per operation)
function pruneBackups(operation, keepCount = 10) {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.includes(`-before-${operation}-`))
      .sort()
      .reverse();
    
    files.slice(keepCount).forEach(f => {
      const filePath = path.join(BACKUPS_DIR, f);
      fs.unlinkSync(filePath);
      console.log(`  Removed old backup: ${f}`);
    });
  } catch (err) {
    console.error(`Error pruning backups:`, err.message);
  }
}

// Check if order is already migrated
function isOrderMigrated(order) {
  return !!(order.paymentStatus || order.statusHistory);
}

// Migrate a single order to extended schema
function migrateOrder(order) {
  // If already migrated, return as-is
  if (isOrderMigrated(order)) {
    console.log(`  ⊘ Skipping ${order.id} - already migrated`);
    return order;
  }

  const now = new Date().toISOString();
  const createdAt = order.createdAt || now;
  
  // Map old status to new status
  const statusMap = {
    'new': OrderStatus.PENDING_CONFIRMATION,
    'confirmed': OrderStatus.CONFIRMED,
    'payment_pending': OrderStatus.PAYMENT_PENDING,
    'preparing': OrderStatus.PRODUCTION,
    'production': OrderStatus.PRODUCTION,
    'shipped': OrderStatus.SHIPPED,
    'delivered': OrderStatus.DELIVERED,
    'cancelled': OrderStatus.CANCELLED,
    'rejected': OrderStatus.REJECTED
  };
  
  const mappedStatus = statusMap[order.status] || OrderStatus.PAYMENT_PENDING;
  
  // Calculate payment deadline: created time + 7 days
  const paymentDeadline = new Date(
    new Date(createdAt).getTime() + 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  
  // Enrich items with inventory mode and estimatedProduction
  const enrichedItems = (order.items || []).map(item => ({
    ...item,
    inventoryMode: item.inventoryMode || 'standard',
    estimatedProduction: item.estimatedProduction || null
  }));
  
  // Create initial status history entry
  const initialReason = mappedStatus === OrderStatus.PENDING_CONFIRMATION
    ? 'Order created by customer'
    : 'Order created - payment required';
  
  const statusHistory = [
    {
      status: mappedStatus,
      changedBy: 'system',
      changedAt: createdAt,
      reason: initialReason
    }
  ];
  
  // Build migrated order
  const migrated = {
    // Original fields
    id: order.id,
    name: order.name,
    phone: order.phone,
    address: order.address,
    note: order.note || '',
    
    // Items with inventory mode
    items: enrichedItems,
    
    // Pricing
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    promoCode: order.promoCode || '',
    total: order.total,
    
    // Payment fields (NEW)
    paymentType: order.paymentType || 'naqd',
    paymentScreenshot: order.paymentScreenshot || '',
    paymentStatus: order.paymentStatus || PaymentStatus.PENDING,
    paymentCollectedAt: order.paymentCollectedAt || null,
    paymentDeadline,
    
    // Status fields (EXTENDED)
    status: mappedStatus,
    statusHistory,
    confirmedAt: order.confirmedAt || null,
    rejectedAt: order.rejectedAt || null,
    rejectionReason: order.rejectionReason || null,
    
    // Timestamps
    createdAt,
    updatedAt: order.updatedAt || now
  };
  
  console.log(`  ✓ Migrated ${order.id} (${order.status} → ${mappedStatus})`);
  return migrated;
}

// Main migration
function executeMigration() {
  console.log('\n📦 Order Schema Migration\n');
  console.log('Reading existing orders...');
  
  const orders = readJson(ORDERS_FILE);
  console.log(`Found ${orders.length} orders\n`);
  
  if (orders.length === 0) {
    console.log('No orders to migrate. Creating empty extended schema.');
    writeJson(ORDERS_FILE, []);
    console.log('✓ Initialized empty orders.json with extended schema\n');
    return;
  }
  
  // Check if already migrated
  const alreadyMigrated = orders.filter(o => isOrderMigrated(o)).length;
  if (alreadyMigrated === orders.length) {
    console.log('⊘ All orders already migrated. No changes needed.\n');
    return;
  }
  
  // Create backup
  console.log('Creating backup...');
  const backupPath = createBackup(ORDERS_FILE, 'schema-extension');
  if (!backupPath) {
    console.error('✗ Failed to create backup. Aborting.');
    process.exit(1);
  }
  
  // Migrate orders
  console.log(`\nMigrating ${orders.length} orders to extended schema...\n`);
  const migratedOrders = orders.map(migrateOrder);
  
  // Write migrated data
  console.log('\nWriting migrated data...');
  if (!writeJson(ORDERS_FILE, migratedOrders)) {
    console.error('✗ Failed to write migrated data. Check backup at:', backupPath);
    process.exit(1);
  }
  
  // Prune old backups
  console.log('\nPruning old backups (keeping last 10)...');
  pruneBackups('schema-extension', 10);
  
  // Summary
  const migratedCount = migratedOrders.filter(o => isOrderMigrated(o)).length;
  console.log(`\n✓ Migration complete!\n`);
  console.log(`  Orders processed: ${orders.length}`);
  console.log(`  Orders migrated: ${migratedCount}`);
  console.log(`  Backup: ${backupPath}\n`);
}

// Run migration
if (require.main === module) {
  executeMigration();
}

module.exports = {
  migrateOrder,
  createBackup,
  pruneBackups,
  executeMigration
};
