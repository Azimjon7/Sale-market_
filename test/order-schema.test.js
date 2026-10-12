/**
 * Tests for Order Schema and Status Management
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
  validateOrderData,
  migrateOrderToExtendedSchema
} = require('../js/order-schema');

describe('Order Schema - Status Transitions', () => {
  test('allows valid status transitions', () => {
    expect(isValidStatusTransition(OrderStatus.PENDING_CONFIRMATION, OrderStatus.CONFIRMED)).toBe(true);
    expect(isValidStatusTransition(OrderStatus.CONFIRMED, OrderStatus.PAYMENT_PENDING)).toBe(true);
    expect(isValidStatusTransition(OrderStatus.PAYMENT_PENDING, OrderStatus.PRODUCTION)).toBe(true);
    expect(isValidStatusTransition(OrderStatus.PRODUCTION, OrderStatus.SHIPPED)).toBe(true);
    expect(isValidStatusTransition(OrderStatus.SHIPPED, OrderStatus.DELIVERED)).toBe(true);
  });

  test('allows rejection from pending_confirmation', () => {
    expect(isValidStatusTransition(OrderStatus.PENDING_CONFIRMATION, OrderStatus.REJECTED)).toBe(true);
    expect(isValidStatusTransition(OrderStatus.PENDING_CONFIRMATION, OrderStatus.CANCELLED)).toBe(true);
  });

  test('prevents invalid status transitions', () => {
    expect(isValidStatusTransition(OrderStatus.PENDING_CONFIRMATION, OrderStatus.SHIPPED)).toBe(false);
    expect(isValidStatusTransition(OrderStatus.SHIPPED, OrderStatus.CONFIRMED)).toBe(false);
    expect(isValidStatusTransition(OrderStatus.DELIVERED, OrderStatus.PRODUCTION)).toBe(false);
  });

  test('allows no-op transitions (same status)', () => {
    expect(isValidStatusTransition(OrderStatus.CONFIRMED, OrderStatus.CONFIRMED)).toBe(true);
  });

  test('prevents transitions from terminal statuses', () => {
    expect(isValidStatusTransition(OrderStatus.DELIVERED, OrderStatus.SHIPPED)).toBe(false);
    expect(isValidStatusTransition(OrderStatus.REJECTED, OrderStatus.CONFIRMED)).toBe(false);
  });
});

describe('Order Schema - Status Labels', () => {
  test('returns Uzbek labels for all statuses', () => {
    expect(getStatusLabel(OrderStatus.PENDING_CONFIRMATION)).toBe('Tasdiqlashni kutmoqda');
    expect(getStatusLabel(OrderStatus.CONFIRMED)).toBe('Tasdiqlandi');
    expect(getStatusLabel(OrderStatus.PAYMENT_PENDING)).toBe('To\'lov kutilmoqda');
    expect(getStatusLabel(OrderStatus.PRODUCTION)).toBe('Tayyorlanmoqda');
    expect(getStatusLabel(OrderStatus.SHIPPED)).toBe('Jo\'natildi');
    expect(getStatusLabel(OrderStatus.DELIVERED)).toBe('Yetkazildi');
    expect(getStatusLabel(OrderStatus.REJECTED)).toBe('Rad etildi');
    expect(getStatusLabel(OrderStatus.CANCELLED)).toBe('Bekor qilindi');
  });
});

describe('Order Schema - Initialization', () => {
  test('initializes order with extended schema for MTO items', () => {
    const baseOrder = {
      id: 'ord_test_1',
      name: 'Test Customer',
      phone: '+998901234567',
      address: 'Test Address',
      note: 'Test note',
      items: [{ productId: 'prd_1', qty: 1, price: 100000, inventoryMode: 'made-to-order' }],
      subtotal: 100000,
      discountAmount: 0,
      promoCode: '',
      total: 100000,
      paymentType: 'naqd',
      createdAt: '2025-01-01T00:00:00.000Z'
    };

    const order = initializeOrderWithExtendedSchema(baseOrder, true);

    expect(order.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(order.paymentStatus).toBe(PaymentStatus.PENDING);
    expect(order.statusHistory).toBeDefined();
    expect(order.statusHistory.length).toBe(1);
    expect(order.statusHistory[0].status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(order.paymentDeadline).toBeDefined();
    expect(order.items[0].inventoryMode).toBe('made-to-order');
  });

  test('initializes order with PAYMENT_PENDING status for standard items only', () => {
    const baseOrder = {
      id: 'ord_test_2',
      name: 'Test Customer',
      phone: '+998901234567',
      address: 'Test Address',
      items: [{ productId: 'prd_1', qty: 1, price: 100000 }],
      subtotal: 100000,
      discountAmount: 0,
      promoCode: '',
      total: 100000,
      paymentType: 'naqd'
    };

    const order = initializeOrderWithExtendedSchema(baseOrder, false);

    expect(order.status).toBe(OrderStatus.PAYMENT_PENDING);
  });

  test('calculates payment deadline as +7 days', () => {
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    const baseOrder = {
      id: 'ord_test_3',
      name: 'Test',
      phone: '+998901234567',
      address: 'Test',
      items: [],
      subtotal: 0,
      discountAmount: 0,
      promoCode: '',
      total: 0,
      createdAt: createdAt.toISOString()
    };

    const order = initializeOrderWithExtendedSchema(baseOrder, true);
    const deadline = new Date(order.paymentDeadline);
    const expected = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);

    expect(deadline.getTime()).toBe(expected.getTime());
  });

  test('enriches items with inventoryMode and estimatedProduction', () => {
    const baseOrder = {
      id: 'ord_test_4',
      name: 'Test',
      phone: '+998901234567',
      address: 'Test',
      items: [
        { productId: 'prd_1', qty: 1, price: 100000 },
        { productId: 'prd_2', qty: 2, price: 50000, inventoryMode: 'made-to-order' }
      ],
      subtotal: 200000,
      discountAmount: 0,
      promoCode: '',
      total: 200000
    };

    const order = initializeOrderWithExtendedSchema(baseOrder, true);

    expect(order.items[0].inventoryMode).toBe('standard');
    expect(order.items[0].estimatedProduction).toBeNull();
    expect(order.items[1].inventoryMode).toBe('made-to-order');
    expect(order.items[1].estimatedProduction).toBeNull();
  });
});

describe('Order Schema - Status History', () => {
  test('creates status history entry with all required fields', () => {
    const entry = createStatusHistoryEntry(
      OrderStatus.CONFIRMED,
      'admin_user_123',
      'Order confirmed by admin'
    );

    expect(entry.status).toBe(OrderStatus.CONFIRMED);
    expect(entry.changedBy).toBe('admin_user_123');
    expect(entry.changedAt).toBeDefined();
    expect(entry.reason).toBe('Order confirmed by admin');
  });

  test('includes metadata when provided', () => {
    const metadata = { ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' };
    const entry = createStatusHistoryEntry(
      OrderStatus.REJECTED,
      'admin_123',
      'Out of stock',
      metadata
    );

    expect(entry.metadata).toEqual(metadata);
  });
});

describe('Order Schema - Status Updates', () => {
  const baseOrder = {
    id: 'ord_test_5',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.PENDING_CONFIRMATION,
    statusHistory: [
      {
        status: OrderStatus.PENDING_CONFIRMATION,
        changedBy: 'system',
        changedAt: new Date().toISOString(),
        reason: 'Order created'
      }
    ]
  };

  test('updates order status successfully with valid transition', () => {
    const result = updateOrderStatus(
      baseOrder,
      OrderStatus.CONFIRMED,
      'admin_123',
      'Confirmed by admin'
    );

    expect(result.success).toBe(true);
    expect(result.order.status).toBe(OrderStatus.CONFIRMED);
    expect(result.order.confirmedAt).toBeDefined();
    expect(result.order.statusHistory.length).toBe(2);
  });

  test('rejects invalid status transitions', () => {
    const result = updateOrderStatus(
      baseOrder,
      OrderStatus.SHIPPED,
      'admin_123',
      'Skip to shipped'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.code).toBe('INVALID_TRANSITION');
  });

  test('records status change with timestamp and user info', () => {
    const result = updateOrderStatus(
      baseOrder,
      OrderStatus.CONFIRMED,
      'admin_user_456',
      'Manual confirmation'
    );

    const lastEntry = result.order.statusHistory[result.order.statusHistory.length - 1];
    expect(lastEntry.status).toBe(OrderStatus.CONFIRMED);
    expect(lastEntry.changedBy).toBe('admin_user_456');
    expect(lastEntry.reason).toBe('Manual confirmation');
  });
});

describe('Order Schema - Confirmation', () => {
  const pendingOrder = {
    id: 'ord_test_6',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.PENDING_CONFIRMATION,
    statusHistory: []
  };

  test('confirms pending order successfully', () => {
    const result = confirmOrder(pendingOrder, 'Confirmed', 'admin_123');

    expect(result.success).toBe(true);
    expect(result.order.status).toBe(OrderStatus.CONFIRMED);
    expect(result.order.confirmedAt).toBeDefined();
  });

  test('rejects confirmation for non-pending orders', () => {
    const confirmedOrder = { ...pendingOrder, status: OrderStatus.CONFIRMED };
    const result = confirmOrder(confirmedOrder, 'Confirm again', 'admin_123');

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_STATUS_FOR_CONFIRMATION');
  });
});

describe('Order Schema - Rejection', () => {
  const pendingOrder = {
    id: 'ord_test_7',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test',
    items: [],
    subtotal: 0,
    discountAmount: 0,
    promoCode: '',
    total: 0,
    status: OrderStatus.PENDING_CONFIRMATION,
    statusHistory: []
  };

  test('rejects pending order successfully', () => {
    const result = rejectOrder(pendingOrder, 'Out of stock', 'admin_123');

    expect(result.success).toBe(true);
    expect(result.order.status).toBe(OrderStatus.REJECTED);
    expect(result.order.rejectedAt).toBeDefined();
    expect(result.order.rejectionReason).toBe('Out of stock');
  });

  test('truncates rejection reason to 500 characters', () => {
    const longReason = 'a'.repeat(1000);
    const result = rejectOrder(pendingOrder, longReason, 'admin_123');

    expect(result.order.rejectionReason.length).toBe(500);
  });

  test('rejects rejection for non-pending orders', () => {
    const confirmedOrder = { ...pendingOrder, status: OrderStatus.CONFIRMED };
    const result = rejectOrder(confirmedOrder, 'Out of stock', 'admin_123');

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_STATUS_FOR_REJECTION');
  });
});

describe('Order Schema - Payment Collection', () => {
  const confirmedOrder = {
    id: 'ord_test_8',
    name: 'Test',
    phone: '+998901234567',
    address: 'Test',
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

  test('records payment collection successfully', () => {
    const result = recordPaymentCollection(confirmedOrder, 'admin_123');

    expect(result.success).toBe(true);
    expect(result.order.paymentStatus).toBe(PaymentStatus.COLLECTED);
    expect(result.order.paymentCollectedAt).toBeDefined();
    expect(result.order.status).toBe(OrderStatus.PRODUCTION);
  });

  test('prevents payment collection for rejected orders', () => {
    const rejectedOrder = { ...confirmedOrder, status: OrderStatus.REJECTED };
    const result = recordPaymentCollection(rejectedOrder, 'admin_123');

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_STATUS_FOR_PAYMENT');
  });
});

describe('Order Schema - Timeline', () => {
  test('returns ordered timeline of status changes', () => {
    const order = {
      id: 'ord_test_9',
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

    const timeline = getOrderTimeline(order);

    expect(timeline.length).toBe(3);
    expect(timeline[0].status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(timeline[1].status).toBe(OrderStatus.CONFIRMED);
    expect(timeline[2].status).toBe(OrderStatus.PRODUCTION);
  });

  test('includes status labels in timeline', () => {
    const order = {
      statusHistory: [
        {
          status: OrderStatus.CONFIRMED,
          changedAt: new Date().toISOString(),
          changedBy: 'admin',
          reason: 'Test'
        }
      ]
    };

    const timeline = getOrderTimeline(order);

    expect(timeline[0].statusLabel).toBe('Tasdiqlandi');
  });
});

describe('Order Schema - Validation', () => {
  test('validates complete order', () => {
    const order = {
      id: 'ord_test_10',
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

    const result = validateOrderData(order);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('detects missing required fields', () => {
    const order = {
      id: 'ord_test_11',
      name: 'Test',
      // missing phone, address, items
    };

    const result = validateOrderData(order);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('detects invalid status', () => {
    const order = {
      id: 'ord_test_12',
      name: 'Test',
      phone: '+998901234567',
      address: 'Test',
      items: [{ productId: 'prd_1', qty: 1, price: 100000 }],
      status: 'invalid_status'
    };

    const result = validateOrderData(order);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid status'))).toBe(true);
  });
});

describe('Order Schema - Migration', () => {
  test('migrates legacy order without extended fields', () => {
    const legacyOrder = {
      id: 'ord_legacy_1',
      name: 'Test',
      phone: '+998901234567',
      address: 'Test',
      items: [],
      subtotal: 0,
      discountAmount: 0,
      promoCode: '',
      total: 0,
      status: 'new',
      createdAt: '2025-01-01T00:00:00.000Z'
    };

    const migrated = migrateOrderToExtendedSchema(legacyOrder);

    expect(migrated.paymentStatus).toBeDefined();
    expect(migrated.statusHistory).toBeDefined();
    expect(migrated.status).toBe(OrderStatus.PENDING_CONFIRMATION);
  });

  test('skips migration for already-extended orders', () => {
    const extendedOrder = {
      id: 'ord_extended_1',
      name: 'Test',
      phone: '+998901234567',
      address: 'Test',
      items: [],
      subtotal: 0,
      discountAmount: 0,
      promoCode: '',
      total: 0,
      paymentStatus: PaymentStatus.COLLECTED,
      statusHistory: []
    };

    const result = migrateOrderToExtendedSchema(extendedOrder);

    expect(result).toEqual(extendedOrder);
  });
});
