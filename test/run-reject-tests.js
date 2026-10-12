/**
 * Simple test runner for reject-order tests
 * Run with: node test/run-reject-tests.js
 */

const {
  OrderStatus,
  PaymentStatus,
  rejectOrder
} = require('../js/order-schema');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    console.log(`\n[TEST] ${name}`);
    fn();
    console.log('  ✓ PASS');
    passCount++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${err.message}`);
    failCount++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected value to be defined`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but got ${actual}`);
      }
    },
    toBeGreaterThan(expected) {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} > ${expected}`);
      }
    },
    toContain(expected) {
      if (!actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      }
    },
    toHaveLength(expected) {
      if (actual.length !== expected) {
        throw new Error(`Expected length ${expected} but got ${actual.length}`);
      }
    }
  };
}

// ── Test Suite: Rejection Status Transitions ───────────────────────────────

test('Rejection updates order status to rejected', () => {
  const baseOrder = {
    id: 'ord_reject_1',
    name: 'Test Customer',
    phone: '+998901234567',
    address: 'Test Address',
    items: [{
      productId: 'prd_standard_1',
      qty: 2,
      price: 100000,
      inventoryMode: 'standard'
    }],
    subtotal: 200000,
    discountAmount: 0,
    promoCode: '',
    total: 200000,
    status: OrderStatus.PENDING_CONFIRMATION,
    paymentStatus: PaymentStatus.PENDING,
    statusHistory: []
  };

  const reason = 'Out of stock for variant';
  const result = rejectOrder(baseOrder, reason, 'admin_123');

  expect(result.success).toBe(true);
  expect(result.order.status).toBe(OrderStatus.REJECTED);
});

test('Rejection sets rejectedAt timestamp', () => {
  const baseOrder = {
    id: 'ord_reject_2',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test Address',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.PENDING_CONFIRMATION,
    statusHistory: []
  };

  const result = rejectOrder(baseOrder, 'Cannot fulfill', 'admin_123');
  
  expect(result.order.rejectedAt).toBeDefined();
  expect(typeof result.order.rejectedAt).toBe('string');
  
  // Validate ISO 8601 format
  const date = new Date(result.order.rejectedAt);
  expect(date.getTime()).toBeGreaterThan(0);
});

test('Rejection stores rejection reason', () => {
  const baseOrder = {
    id: 'ord_reject_3',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test Address',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.PENDING_CONFIRMATION,
    statusHistory: []
  };

  const reason = 'Product variant no longer available';
  const result = rejectOrder(baseOrder, reason, 'admin_123');

  expect(result.order.rejectionReason).toBe(reason);
});

test('Rejection reason truncated to 500 characters', () => {
  const baseOrder = {
    id: 'ord_reject_4',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test Address',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.PENDING_CONFIRMATION,
    statusHistory: []
  };

  const longReason = 'a'.repeat(1000);
  const result = rejectOrder(baseOrder, longReason, 'admin_123');

  expect(result.order.rejectionReason.length).toBe(500);
});

test('Rejection records in status history with admin user ID', () => {
  const baseOrder = {
    id: 'ord_reject_5',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test Address',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.PENDING_CONFIRMATION,
    statusHistory: []
  };

  const reason = 'Out of stock';
  const adminId = 'admin_user_456';
  const result = rejectOrder(baseOrder, reason, adminId);

  expect(result.order.statusHistory.length).toBeGreaterThan(0);
  const lastEntry = result.order.statusHistory[result.order.statusHistory.length - 1];
  expect(lastEntry.status).toBe(OrderStatus.REJECTED);
  expect(lastEntry.changedBy).toBe(adminId);
  expect(lastEntry.reason).toContain(reason);
});

// ── Test Suite: Payment Prevention ─────────────────────────────────────────

test('Rejection prevents payment collection', () => {
  const order = {
    id: 'ord_reject_6',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test Address',
    items: [{ productId: 'prd_1', qty: 1, price: 100000 }],
    subtotal: 100000,
    discountAmount: 0,
    promoCode: '',
    total: 100000,
    status: OrderStatus.PENDING_CONFIRMATION,
    paymentStatus: PaymentStatus.PENDING,
    statusHistory: []
  };

  const result = rejectOrder(order, 'Out of stock', 'admin_123');

  expect(result.order.paymentStatus).toBe(PaymentStatus.PENDING);
  // Payment should not be collected (null or undefined both acceptable)
  if (result.order.paymentCollectedAt !== null && result.order.paymentCollectedAt !== undefined) {
    throw new Error(`Expected paymentCollectedAt to be null or undefined but got ${result.order.paymentCollectedAt}`);
  }
});

// ── Test Suite: Error Cases ───────────────────────────────────────────────

test('Rejection fails for confirmed orders', () => {
  const order = {
    id: 'ord_reject_7',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test Address',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.CONFIRMED,
    statusHistory: []
  };

  const result = rejectOrder(order, 'Try to reject', 'admin_123');

  expect(result.success).toBe(false);
  expect(result.code).toBe('INVALID_STATUS_FOR_REJECTION');
});

test('Rejection fails for shipped orders', () => {
  const order = {
    id: 'ord_reject_8',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test Address',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.SHIPPED,
    statusHistory: []
  };

  const result = rejectOrder(order, 'Reject after shipping', 'admin_123');

  expect(result.success).toBe(false);
  expect(result.code).toBe('INVALID_STATUS_FOR_REJECTION');
});

test('Rejection fails for already-rejected orders', () => {
  const order = {
    id: 'ord_reject_9',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test Address',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.REJECTED,
    rejectedAt: new Date().toISOString(),
    rejectionReason: 'Previously rejected',
    statusHistory: []
  };

  const result = rejectOrder(order, 'Try again', 'admin_123');

  expect(result.success).toBe(false);
});

// ── Test Suite: Response Format ───────────────────────────────────────────

test('Rejection response includes required fields', () => {
  const order = {
    id: 'ord_reject_10',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test Address',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.PENDING_CONFIRMATION,
    paymentStatus: PaymentStatus.PENDING,
    statusHistory: []
  };

  const result = rejectOrder(order, 'Test rejection', 'admin_123');

  expect(result.success).toBe(true);
  expect(result.order).toBeDefined();
  expect(result.order.id).toBe(order.id);
  expect(result.order.status).toBe(OrderStatus.REJECTED);
  expect(result.order.rejectionReason).toBe('Test rejection');
  expect(result.order.rejectedAt).toBeDefined();
  expect(result.order.statusHistory).toBeDefined();
  expect(Array.isArray(result.order.statusHistory)).toBe(true);
});

// ── Results ────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Tests completed: ${passCount} passed, ${failCount} failed`);
console.log('='.repeat(60));

if (failCount === 0) {
  console.log('\n✓ All tests passed!');
  process.exit(0);
} else {
  console.log(`\n✗ ${failCount} test(s) failed`);
  process.exit(1);
}
