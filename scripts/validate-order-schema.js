#!/usr/bin/env node

/**
 * Validation script for order schema operations
 * Tests all helper functions to ensure they work correctly
 */

const {
  OrderStatus,
  PaymentStatus,
  isValidStatusTransition,
  getStatusLabel,
  initializeOrderWithExtendedSchema,
  createStatusHistoryEntry,
  updateOrderStatus,
  recordPaymentCollection,
  rejectOrder,
  confirmOrder,
  getOrderTimeline,
  validateOrderData
} = require('../js/order-schema');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.log(`  ✗ ${message}`);
    failedTests++;
  }
}

console.log('\n📋 Order Schema Validation Tests\n');

// Test 1: Status Transitions
console.log('1. Testing Status Transitions');
assert(isValidStatusTransition(OrderStatus.PENDING_CONFIRMATION, OrderStatus.CONFIRMED), 'Allows pending → confirmed');
assert(isValidStatusTransition(OrderStatus.CONFIRMED, OrderStatus.PAYMENT_PENDING), 'Allows confirmed → payment_pending');
assert(isValidStatusTransition(OrderStatus.PAYMENT_PENDING, OrderStatus.PRODUCTION), 'Allows payment_pending → production');
assert(!isValidStatusTransition(OrderStatus.PENDING_CONFIRMATION, OrderStatus.SHIPPED), 'Rejects invalid transitions');
assert(!isValidStatusTransition(OrderStatus.DELIVERED, OrderStatus.PRODUCTION), 'Prevents regression from terminal status');

// Test 2: Status Labels
console.log('\n2. Testing Status Labels');
assert(getStatusLabel(OrderStatus.PENDING_CONFIRMATION) === 'Tasdiqlashni kutmoqda', 'Returns Uzbek label for pending_confirmation');
assert(getStatusLabel(OrderStatus.CONFIRMED) === 'Tasdiqlandi', 'Returns Uzbek label for confirmed');
assert(getStatusLabel(OrderStatus.PRODUCTION) === 'Tayyorlanmoqda', 'Returns Uzbek label for production');

// Test 3: Order Initialization
console.log('\n3. Testing Order Initialization');
const baseOrder = {
  id: 'ord_test_1',
  name: 'Test Customer',
  phone: '+998901234567',
  address: 'Test Address',
  note: 'Test note',
  items: [
    { productId: 'prd_1', qty: 1, price: 100000, inventoryMode: 'made-to-order' }
  ],
  subtotal: 100000,
  discountAmount: 0,
  promoCode: '',
  total: 100000,
  paymentType: 'naqd',
  createdAt: '2025-01-01T00:00:00.000Z'
};

const order = initializeOrderWithExtendedSchema(baseOrder, true);
assert(order.status === OrderStatus.PENDING_CONFIRMATION, 'Sets status to pending_confirmation for MTO items');
assert(order.paymentStatus === PaymentStatus.PENDING, 'Sets paymentStatus to pending');
assert(order.statusHistory.length === 1, 'Creates initial status history entry');
assert(order.paymentDeadline !== null, 'Calculates payment deadline');
assert(order.items[0].inventoryMode === 'made-to-order', 'Enriches items with inventory mode');

// Test 4: Status History
console.log('\n4. Testing Status History');
const entry = createStatusHistoryEntry(OrderStatus.CONFIRMED, 'admin_123', 'Confirmed by admin');
assert(entry.status === OrderStatus.CONFIRMED, 'Creates entry with correct status');
assert(entry.changedBy === 'admin_123', 'Records admin user ID');
assert(entry.changedAt !== undefined, 'Records timestamp');
assert(entry.reason === 'Confirmed by admin', 'Records reason');

// Test 5: Order Confirmation
console.log('\n5. Testing Order Confirmation');
const pendingOrder = {
  id: 'ord_test_2',
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

const confirmResult = confirmOrder(pendingOrder, 'Confirmed by admin', 'admin_123');
assert(confirmResult.success === true, 'Confirmation succeeds for pending orders');
assert(confirmResult.order.status === OrderStatus.CONFIRMED, 'Updates status to confirmed');
assert(confirmResult.order.confirmedAt !== null, 'Records confirmation timestamp');
assert(confirmResult.order.statusHistory.length > 0, 'Adds entry to status history');

// Test 6: Order Rejection
console.log('\n6. Testing Order Rejection');
const rejectResult = rejectOrder(pendingOrder, 'Out of stock', 'admin_456');
assert(rejectResult.success === true, 'Rejection succeeds for pending orders');
assert(rejectResult.order.status === OrderStatus.REJECTED, 'Updates status to rejected');
assert(rejectResult.order.rejectionReason === 'Out of stock', 'Stores rejection reason');
assert(rejectResult.order.rejectedAt !== null, 'Records rejection timestamp');

// Test 7: Payment Collection
console.log('\n7. Testing Payment Collection');
const confirmedOrderForPayment = {
  id: 'ord_test_3',
  name: 'Test',
  phone: '+998901234567',
  address: 'Test Address',
  items: [],
  subtotal: 100000,
  discountAmount: 0,
  promoCode: '',
  total: 100000,
  status: OrderStatus.CONFIRMED,
  paymentStatus: PaymentStatus.PENDING,
  paymentCollectedAt: null,
  statusHistory: []
};

const paymentResult = recordPaymentCollection(confirmedOrderForPayment, 'admin_123');
assert(paymentResult.success === true, 'Payment collection succeeds for confirmed orders');
assert(paymentResult.order.paymentStatus === PaymentStatus.COLLECTED, 'Updates payment status to collected');
assert(paymentResult.order.status === OrderStatus.PRODUCTION, 'Moves order to production');
assert(paymentResult.order.paymentCollectedAt !== null, 'Records payment collection timestamp');

// Test 8: Status Updates with Validation
console.log('\n8. Testing Status Update Validation');
const invalidTransitionResult = updateOrderStatus(pendingOrder, OrderStatus.SHIPPED, 'admin_123', 'Skip to shipped');
assert(invalidTransitionResult.success === false, 'Rejects invalid status transitions');
assert(invalidTransitionResult.code === 'INVALID_TRANSITION', 'Returns error code for invalid transitions');

const validTransitionResult = updateOrderStatus(pendingOrder, OrderStatus.CONFIRMED, 'admin_123', 'Confirmed');
assert(validTransitionResult.success === true, 'Allows valid status transitions');

// Test 9: Timeline Generation
console.log('\n9. Testing Timeline Generation');
const orderWithHistory = {
  id: 'ord_test_4',
  statusHistory: [
    {
      status: OrderStatus.PENDING_CONFIRMATION,
      changedAt: '2025-01-01T10:00:00.000Z',
      changedBy: 'system',
      reason: 'Created'
    },
    {
      status: OrderStatus.CONFIRMED,
      changedAt: '2025-01-01T11:00:00.000Z',
      changedBy: 'admin_123',
      reason: 'Confirmed'
    },
    {
      status: OrderStatus.PRODUCTION,
      changedAt: '2025-01-01T12:00:00.000Z',
      changedBy: 'admin_123',
      reason: 'Payment received'
    }
  ]
};

const timeline = getOrderTimeline(orderWithHistory);
assert(timeline.length === 3, 'Timeline has all status changes');
assert(timeline[0].status === OrderStatus.PENDING_CONFIRMATION, 'Timeline is ordered chronologically');
assert(timeline[1].statusLabel === 'Tasdiqlandi', 'Timeline includes status labels');

// Test 10: Order Validation
console.log('\n10. Testing Order Validation');
const validOrder = {
  id: 'ord_test_5',
  name: 'Test Customer',
  phone: '+998901234567',
  address: 'Test Address',
  items: [{ productId: 'prd_1', qty: 1, price: 100000 }],
  subtotal: 100000,
  discountAmount: 0,
  promoCode: '',
  total: 100000,
  status: OrderStatus.CONFIRMED,
  paymentStatus: PaymentStatus.PENDING,
  statusHistory: []
};

const validationResult = validateOrderData(validOrder);
assert(validationResult.valid === true, 'Validates complete orders');
assert(validationResult.errors.length === 0, 'Valid orders have no errors');

const invalidOrder = {
  id: 'ord_test_6',
  name: 'Test',
  // missing required fields
};

const invalidValidationResult = validateOrderData(invalidOrder);
assert(invalidValidationResult.valid === false, 'Rejects incomplete orders');
assert(invalidValidationResult.errors.length > 0, 'Reports errors for invalid orders');

// Summary
console.log('\n' + '='.repeat(50));
console.log(`\nResults: ${passedTests} passed, ${failedTests} failed\n`);

if (failedTests === 0) {
  console.log('✓ All validation tests passed!\n');
  process.exit(0);
} else {
  console.log(`✗ ${failedTests} test(s) failed\n`);
  process.exit(1);
}
