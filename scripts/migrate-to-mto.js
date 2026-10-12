#!/usr/bin/env node

/**
 * BUYO Product Migration to Made-to-Order (MTO)
 * 
 * This script:
 * 1. Backs up data/products.json to data/backups/ with timestamp
 * 2. Identifies all BUYO products (sourceName: "BUYO" or _buyo_id with "buyo_" prefix)
 * 3. Marks identified BUYO products as made-to-order:
 *    - _inventoryMode: "made-to-order"
 *    - _acceptsMTO: true
 *    - _productionDays: 14
 *    - stock: 0
 * 4. Preserves all existing metadata (images, pricing, description, variants)
 * 5. Logs migration summary
 * 6. Implements idempotent execution (skips already-migrated products)
 * 
 * Usage: node migrate-to-mto.js [--dry-run] [--keep-backups N]
 *   --dry-run         Preview changes without writing
 *   --keep-backups N  Keep N backups per operation (default: 10)
 */

const fs = require('fs');
const path = require('path');

// Configuration
const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const OPERATION_NAME = 'mto-migration';

// Parse command-line options
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keepBackups = (() => {
  const idx = args.indexOf('--keep-backups');
  if (idx >= 0 && idx + 1 < args.length) {
    const num = parseInt(args[idx + 1], 10);
    return isNaN(num) ? 10 : num;
  }
  return 10;
})();

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Read JSON file safely
 */
function readJsonFile(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    throw error;
  }
}

/**
 * Write JSON file atomically
 * Write to temp file first, then rename to target to ensure atomic writes
 */
function writeJsonFileAtomic(filePath, data) {
  const tempPath = filePath + '.tmp';
  const backupPath = filePath + '.backup';
  
  try {
    // Write to temporary file
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    
    // Create backup of current file if it exists
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
    }
    
    // Rename temp file to target (atomic operation)
    fs.renameSync(tempPath, filePath);
    
    // Clean up backup
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
  } catch (error) {
    // Cleanup temp file on error
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

/**
 * Create backup with timestamp
 */
function createBackup(sourceFile, operation) {
  try {
    ensureDir(BACKUPS_DIR);
    
    const timestamp = Date.now();
    const backupName = `${path.basename(sourceFile, '.json')}-before-${operation}-${timestamp}.json`;
    const backupPath = path.join(BACKUPS_DIR, backupName);
    
    fs.copyFileSync(sourceFile, backupPath);
    console.log(`✓ Backup created: ${backupName}`);
    
    return backupPath;
  } catch (error) {
    console.error(`Error creating backup:`, error.message);
    throw error;
  }
}

/**
 * Cleanup old backups, keeping only the most recent N per operation
 */
function pruneBackups(operation, keepCount) {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      return;
    }
    
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.includes(`-before-${operation}-`))
      .sort()
      .reverse(); // Most recent first
    
    const toDelete = files.slice(keepCount);
    
    toDelete.forEach(file => {
      const filePath = path.join(BACKUPS_DIR, file);
      fs.unlinkSync(filePath);
    });
    
    if (toDelete.length > 0) {
      console.log(`✓ Pruned ${toDelete.length} old backups (kept ${Math.min(files.length, keepCount)})`);
    }
  } catch (error) {
    console.error(`Warning: Error pruning backups:`, error.message);
    // Don't throw - pruning is not critical
  }
}

/**
 * Check if a product is from BUYO
 */
function isBuyoProduct(product) {
  // Check sourceName
  if (product.sourceName === 'BUYO') {
    return true;
  }
  
  // Check _buyo_id (legacy field or future migrations)
  if (product._buyo_id && String(product._buyo_id).startsWith('buyo_')) {
    return true;
  }
  
  return false;
}

/**
 * Check if product is already migrated to MTO
 */
function isAlreadyMigrated(product) {
  return product._inventoryMode === 'made-to-order';
}

/**
 * Migrate a single product to MTO
 */
function migrateProductToMTO(product) {
  // Skip if already migrated
  if (isAlreadyMigrated(product)) {
    return {
      product,
      migrated: false,
      reason: 'already migrated'
    };
  }
  
  // Skip if not a BUYO product
  if (!isBuyoProduct(product)) {
    return {
      product,
      migrated: false,
      reason: 'not BUYO'
    };
  }
  
  // Migrate to MTO
  const migrated = {
    ...product,
    _inventoryMode: 'made-to-order',
    _acceptsMTO: true,
    _productionDays: 14,
    stock: 0
  };
  
  return {
    product: migrated,
    migrated: true,
    reason: null
  };
}

/**
 * Main migration logic
 */
async function executeMigration() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   BUYO Product MTO Migration Script    ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  try {
    // Check if products file exists
    if (!fs.existsSync(PRODUCTS_FILE)) {
      console.error(`Error: Products file not found: ${PRODUCTS_FILE}`);
      process.exit(1);
    }
    
    // Read products
    console.log('📖 Reading products...');
    const products = readJsonFile(PRODUCTS_FILE, []);
    console.log(`  Loaded ${products.length} products`);
    
    // Analyze what would be migrated
    const stats = {
      total: products.length,
      buyoProducts: 0,
      alreadyMigrated: 0,
      toMigrate: 0,
      errors: []
    };
    
    const results = products.map((product, index) => {
      try {
        if (isBuyoProduct(product)) {
          stats.buyoProducts++;
          
          if (isAlreadyMigrated(product)) {
            stats.alreadyMigrated++;
          } else {
            stats.toMigrate++;
          }
        }
        
        return migrateProductToMTO(product);
      } catch (error) {
        stats.errors.push({
          productId: product.id || 'unknown',
          index,
          error: error.message
        });
        return {
          product,
          migrated: false,
          reason: `error: ${error.message}`
        };
      }
    });
    
    // Display analysis
    console.log('\n📊 Migration Analysis:');
    console.log(`  Total products: ${stats.total}`);
    console.log(`  BUYO products: ${stats.buyoProducts}`);
    console.log(`  Already migrated: ${stats.alreadyMigrated}`);
    console.log(`  Ready to migrate: ${stats.toMigrate}`);
    
    if (stats.errors.length > 0) {
      console.log(`  Errors encountered: ${stats.errors.length}`);
      stats.errors.slice(0, 5).forEach(err => {
        console.log(`    - Product ${err.productId}: ${err.error}`);
      });
      if (stats.errors.length > 5) {
        console.log(`    ... and ${stats.errors.length - 5} more`);
      }
    }
    
    // Check if there's anything to do
    const migratedProducts = results.filter(r => r.migrated);
    if (migratedProducts.length === 0 && stats.errors.length === 0) {
      console.log('\n✨ No products to migrate (all BUYO products already migrated)');
      return;
    }
    
    // If dry-run, stop here
    if (dryRun) {
      console.log('\n🏁 Dry-run complete. No changes written.');
      return;
    }
    
    // Create backup before writing
    console.log('\n💾 Creating backup...');
    const backupPath = createBackup(PRODUCTS_FILE, OPERATION_NAME);
    
    // Write migrated products
    console.log('✍️  Writing migrated products...');
    const migratedData = results.map(r => r.product);
    writeJsonFileAtomic(PRODUCTS_FILE, migratedData);
    console.log(`  ✓ Wrote ${migratedData.length} products`);
    
    // Cleanup old backups
    console.log('\n🧹 Managing backups...');
    pruneBackups(OPERATION_NAME, keepBackups);
    
    // Final report
    console.log('\n✅ Migration completed successfully!');
    console.log(`\n📈 Summary:`);
    console.log(`  • Migrated: ${migratedProducts.length} products`);
    console.log(`  • Already migrated: ${stats.alreadyMigrated} products`);
    console.log(`  • Unchanged: ${stats.total - stats.buyoProducts} products`);
    console.log(`  • Errors: ${stats.errors.length} products`);
    console.log(`\n📁 Backup location: ${backupPath}`);
    console.log(`\n✨ All BUYO products are now marked as made-to-order with stock=0\n`);
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run migration
executeMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
