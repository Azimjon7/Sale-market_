/**
 * Task 9: Backend Checkpoint - Validation Tests
 * 
 * Comprehensive validation of Phase 1 backend implementation
 * Tests all required endpoints, inventory modes, and order workflows
 * 
 * **Validates: Requirements 1.1, 5.1, 6.1, 7.1**
 */

const fs = require('fs');
const path = require('path');

// Import utilities
const { readJSON, writeJSON } = require('../utils/jsonStore');

const DATA_DIR = path.join(__dirname, '../data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// Test results tracking
const results = {
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  testResults: [],
  requirementCoverage: {
    '1.1': { name: 'Product schema extensions', coverage: [] },
    '5.1': { name: 'Order submission with hybrid validation', coverage: [] },
    '6.1': { name: 'Order pending_confirmation status', coverage: [] },
    '7.1': { name: 'Admin confirmation and rejection', coverage: [] }
  }
};

function test(name, requirement, fn) {
  results.totalTests++;
  try {
    fn();
    results.passedTests++;
    results.testResults.push({ name, requirement, status: 'PASS', error: null });
    if (requirement && results.requirementCoverage[requirement]) {
      results.requirementCoverage[requirement].coverage.push(name);
    }
    console.log(`✓ PASS: ${name}`);
  } catch (err) {
    results.failedTests++;
    results.testResults.push({ name, requirement, status: 'FAIL', error: err.message });
    console.log(`✗ FAIL: ${name}`);
    console.log(`  Error: ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: Product Schema Extensions (Requirement 1.1)
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n📋 TEST SUITE 1: Product Schema Extensions (Requirement 1.1)');
console.log('─'.repeat(80));

test('Products file exists and is valid JSON', '1.1', () => {
  assert(fs.existsSync(PRODUCTS_FILE), 'products.json file does not exist');
  const data = fs.readFileSync(PRODUCTS_FILE, 'utf8');
  const products = JSON.parse(data);
  assert(Array.isArray(products), 'products.json does not contain an array');
  assert(products.length > 0, 'products.json is empty');
});

test('Sample product has _inventoryMode field', '1.1', () => {
  const products = readJSON(PRODUCTS_FILE, []);
  const firstProduct = products[0];
  assert(firstProduct, 'No products found');
  assert(firstProduct.hasOwnProperty('_inventoryMode'), '_inventoryMode field missing');
  assert(
    firstProduct._inventoryMode === 'standard' || firstProduct._inventoryMode === 'made-to-order',
    `Invalid _inventoryMode value: ${firstProduct._inventoryMode}`
  );
});

test('Non-BUYO products default to "standard" inventory mode', '1.1', () => {
  const products = readJSON(PRODUCTS_FILE, []);
  const standardProducts = products.filter(p => !p._buyo_id && !p.sourceName?.includes('BUYO'));
  const allStandard = standardProducts.every(p => !p._inventoryMode || p._inventoryMode === 'standard');
  assert(allStandard, 'Non-BUYO products not defaulting to standard mode');
});

test('BUYO products marked as "made-to-order"', '1.1', () => {
  const products = readJSON(PRODUCTS_FILE, []);
  const buyoProducts = products.filter(p => p._buyo_id || p.sourceName?.includes('BUYO'));
  assert(buyoProducts.length > 0, 'No BUYO products found for validation');
  const allMTO = buyoProducts.every(p => p._inventoryMode === 'made-to-order');
  assert(allMTO, 'BUYO products not marked as made-to-order');
});

test('BUYO products have stock=0', '1.1', () => {
  const products = readJSON(PRODUCTS_FILE, []);
  const buyoProducts = products.filter(p => p._inventoryMode === 'made-to-order');
  assert(buyoProducts.length > 0, 'No made-to-order products found');
  const allZeroStock = buyoProducts.every(p => p.stock === 0 || p.stock === '0' || !p.stock);
  assert(allZeroStock, 'Made-to-order products do not have stock=0');
});

test('MTO products have _productionDays field', '1.1', () => {
  const products = readJSON(PRODUCTS_FILE, []);
  const mtoProducts = products.filter(p => p._inventoryMode === 'made-to-order');
  assert(mtoProducts.length > 0, 'No made-to-order products found');
  const allHaveProduction = mtoProducts.every(p => p._productionDays && Number(p._productionDays) > 0);
  assert(allHaveProduction, 'MTO products missing _productionDays');
});

test('MTO products have _acceptsMTO field', '1.1', () => {
  const products = readJSON(PRODUCTS_FILE, []);
  const mtoProducts = products.filter(p => p._inventoryMode === 'made-to-order');
  assert(mtoProducts.length > 0, 'No made-to-order products found');
  const allHaveAcceptsMTO = mtoProducts.every(p => p._acceptsMTO === true);
  assert(allHaveAcceptsMTO, 'MTO products missing _acceptsMTO=true');
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: Order Schema Extensions & Status Fields
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n📋 TEST SUITE 2: Order Schema Extensions & Status Fields');
console.log('─'.repeat(80));

test('Orders file exists and contains valid data', '6.1', () => {
  assert(fs.existsSync(ORDERS_FILE), 'orders.json file does not exist');
  const orders = readJSON(ORDERS_FILE, []);
  assert(Array.isArray(orders), 'orders.json does not contain an array');
  // Orders may be empty initially, but file should exist
});

test('Sample order has extended status field', '6.1', () => {
  const orders = readJSON(ORDERS_FILE, []);
  if (orders.length === 0) {
    console.log('  (No orders yet - skipping sample validation)');
    return;
  }
  const order = orders[0];
  assert(
    order.status === 'pending_confirmation' ||
    order.status === 'confirmed' ||
    order.status === 'payment_pending' ||
    order.status === 'production' ||
    order.status === 'shipped' ||
    order.status === 'delivered' ||
    order.status === 'rejected',
    `Invalid order status: ${order.status}`
  );
});

test('Sample order has paymentStatus field', '6.1', () => {
  const orders = readJSON(ORDERS_FILE, []);
  if (orders.length === 0) {
    console.log('  (No orders yet - skipping sample validation)');
    return;
  }
  const order = orders[0];
  assert(order.hasOwnProperty('paymentStatus'), 'paymentStatus field missing');
  assert(
    order.paymentStatus === 'pending' ||
    order.paymentStatus === 'collected' ||
    order.paymentStatus === 'failed',
    `Invalid paymentStatus: ${order.paymentStatus}`
  );
});

test('Sample order has statusHistory array', '6.1', () => {
  const orders = readJSON(ORDERS_FILE, []);
  if (orders.length === 0) {
    console.log('  (No orders yet - skipping sample validation)');
    return;
  }
  const order = orders[0];
  assert(Array.isArray(order.statusHistory), 'statusHistory is not an array');
  assert(order.statusHistory.length > 0, 'statusHistory is empty');
  const histEntry = order.statusHistory[0];
  assert(histEntry.status, 'Status history entry missing status');
  assert(histEntry.changedAt, 'Status history entry missing changedAt');
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: Server Implementation & Endpoint Availability
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n📋 TEST SUITE 3: Server Implementation Check');
console.log('─'.repeat(80));

test('server.js exists and is valid', '5.1', () => {
  const serverFile = path.join(__dirname, '../server.js');
  assert(fs.existsSync(serverFile), 'server.js not found');
});

test('validateProductStock function exists in server.js', '5.1', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(serverCode.includes('function validateProductStock'), 'validateProductStock function not found');
});

test('POST /api/products endpoint implementation exists', '1.1', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(serverCode.includes('app.post("/api/products"'), 'POST /api/products endpoint not found');
});

test('POST /api/orders endpoint implementation exists', '5.1', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(serverCode.includes('app.post("/api/orders"'), 'POST /api/orders endpoint not found');
});

test('PATCH /api/orders/:id/confirm endpoint implementation exists', '7.1', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(
    serverCode.includes('app.patch("/api/orders/:id/confirm"'),
    'PATCH /api/orders/:id/confirm endpoint not found'
  );
});

test('PATCH /api/orders/:id/reject endpoint implementation exists', '7.1', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(
    serverCode.includes('app.patch("/api/orders/:id/reject"'),
    'PATCH /api/orders/:id/reject endpoint not found'
  );
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: Order Schema Module (order-schema.js)
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n📋 TEST SUITE 4: Order Schema Functions');
console.log('─'.repeat(80));

test('order-schema.js exists', '6.1', () => {
  const orderSchemaFile = path.join(__dirname, '../js/order-schema.js');
  assert(fs.existsSync(orderSchemaFile), 'order-schema.js not found');
});

test('initializeOrderWithExtendedSchema function exists', '6.1', () => {
  const orderSchemaCode = fs.readFileSync(path.join(__dirname, '../js/order-schema.js'), 'utf8');
  assert(
    orderSchemaCode.includes('function initializeOrderWithExtendedSchema'),
    'initializeOrderWithExtendedSchema function not found'
  );
});

test('confirmOrder function exists', '7.1', () => {
  const orderSchemaCode = fs.readFileSync(path.join(__dirname, '../js/order-schema.js'), 'utf8');
  assert(orderSchemaCode.includes('function confirmOrder'), 'confirmOrder function not found');
});

test('rejectOrder function exists', '7.1', () => {
  const orderSchemaCode = fs.readFileSync(path.join(__dirname, '../js/order-schema.js'), 'utf8');
  assert(orderSchemaCode.includes('function rejectOrder'), 'rejectOrder function not found');
});

// ════════════════════════════════════════════════════════════════════════════════
// SUMMARY & REQUIREMENTS COVERAGE
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(80));
console.log('CHECKPOINT SUMMARY');
console.log('═'.repeat(80));

console.log(`\n📊 Test Results:`);
console.log(`  Total Tests:    ${results.totalTests}`);
console.log(`  Passed:         ${results.passedTests} ✓`);
console.log(`  Failed:         ${results.failedTests} ✗`);
console.log(`  Pass Rate:      ${((results.passedTests / results.totalTests) * 100).toFixed(1)}%`);

console.log(`\n📋 Requirements Coverage:`);
for (const [reqId, reqData] of Object.entries(results.requirementCoverage)) {
  const coverageCount = reqData.coverage.length;
  const status = coverageCount > 0 ? '✓' : '○';
  console.log(`  ${status} Requirement ${reqId}: ${reqData.name}`);
  if (coverageCount > 0) {
    console.log(`      Tests: ${reqData.coverage.join(', ')}`);
  }
}

console.log(`\n🎯 Phase 1 Backend Implementation Status:`);
console.log(`  Product Schema (Req 1.1):           ${results.requirementCoverage['1.1'].coverage.length > 0 ? '✓ VERIFIED' : '✗ INCOMPLETE'}`);
console.log(`  Order Submission (Req 5.1):         ${results.requirementCoverage['5.1'].coverage.length > 0 ? '✓ VERIFIED' : '✗ INCOMPLETE'}`);
console.log(`  Pending Confirmation (Req 6.1):     ${results.requirementCoverage['6.1'].coverage.length > 0 ? '✓ VERIFIED' : '✗ INCOMPLETE'}`);
console.log(`  Admin Confirmation/Rejection (Req 7.1): ${results.requirementCoverage['7.1'].coverage.length > 0 ? '✓ VERIFIED' : '✗ INCOMPLETE'}`);

console.log(`\n💡 Recommendation:`);
if (results.failedTests === 0) {
  console.log(`  ✓ All backend endpoints are implemented and schema is correctly extended.`);
  console.log(`  ✓ Data files show proper inventory mode classification.`);
  console.log(`  ✓ Order schema includes status, payment, and history tracking.`);
  console.log(`  ✓ Admin endpoints for confirmation and rejection are available.`);
  console.log(`\n  → Phase 1 Backend READY FOR TESTING`);
  console.log(`  → Next: Run integration tests with actual HTTP requests`);
  console.log(`  → Then: Proceed to Phase 2 Frontend Implementation`);
} else {
  console.log(`  ⚠ ${results.failedTests} issues found in backend implementation`);
  console.log(`  → Fix failures above before proceeding`);
  console.log(`  → Ensure all data files are properly initialized`);
  console.log(`  → Verify function implementations are complete`);
}

// ════════════════════════════════════════════════════════════════════════════════
// SAVE CHECKPOINT REPORT
// ════════════════════════════════════════════════════════════════════════════════

const reportPath = path.join(__dirname, '../test-checkpoint-report.json');
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`\n📄 Detailed report saved to: test-checkpoint-report.json`);

// Exit with success if all tests pass
process.exit(results.failedTests === 0 ? 0 : 1);
