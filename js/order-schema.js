/**
 * Order Schema & Status Management
 * Provides helper functions for order schema operations, status transitions, and validation
 */

/**
 * Valid order status enum
 */
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

/**
 * Valid payment status enum
 */
const PaymentStatus = {
  PENDING: 'pending',
  COLLECTED: 'collected',
  FAILED: 'failed'
};

/**
 * Status transition rules: defines which statuses can transition to which
 */
const StatusTransitions = {
  [OrderStatus.PENDING_CONFIRMATION]: [
    OrderStatus.CONFIRMED,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED
  ],
  [OrderStatus.CONFIRMED]: [
    OrderStatus.PAYMENT_PENDING,
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED
  ],
  [OrderStatus.PAYMENT_PENDING]: [
    OrderStatus.PRODUCTION,
    OrderStatus.CANCELLED,
    OrderStatus.REJECTED
  ],
  [OrderStatus.PRODUCTION]: [
    OrderStatus.SHIPPED
  ],
  [OrderStatus.SHIPPED]: [
    OrderStatus.DELIVERED
  ],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.CANCELLED]: []
};

/**
 * Check if a status transition is valid
 * @param {string} currentStatus - Current order status
 * @param {string} newStatus - Desired new status
 * @returns {boolean} True if transition is allowed
 */
function isValidStatusTransition(currentStatus, newStatus) {
  if (!Object.values(OrderStatus).includes(currentStatus) || !Object.values(OrderStatus).includes(newStatus)) return false;
  if (currentStatus === newStatus) return true; // No-op is always valid
  const allowedTransitions = StatusTransitions[currentStatus] || [];
  return allowedTransitions.includes(newStatus);
}

/**
 * Get human-readable status message in Uzbek
 * @param {string} status - Order status
 * @returns {string} Uzbek status message
 */
function getStatusLabel(status) {
  const labels = {
    [OrderStatus.PENDING_CONFIRMATION]: 'Tasdiqlashni kutmoqda',
    [OrderStatus.CONFIRMED]: 'Tasdiqlandi',
    [OrderStatus.PAYMENT_PENDING]: 'To\'lov kutilmoqda',
    [OrderStatus.PRODUCTION]: 'Tayyorlanmoqda',
    [OrderStatus.SHIPPED]: 'Jo\'natildi',
    [OrderStatus.DELIVERED]: 'Yetkazildi',
    [OrderStatus.REJECTED]: 'Rad etildi',
    [OrderStatus.CANCELLED]: 'Bekor qilindi'
  };
  return labels[status] || status;
}

/**
 * Initialize a new order with extended schema
 * @param {Object} baseOrder - Base order object with basic fields
 * @param {boolean} hasMadeToOrder - Whether order contains any made-to-order items
 * @returns {Object} Complete order with extended schema
 */
function initializeOrderWithExtendedSchema(baseOrder, hasMadeToOrder = false) {
  const now = new Date().toISOString();
  const createdAt = baseOrder.createdAt || now;
  
  // Determine initial status based on order contents
  const initialStatus = hasMadeToOrder ? OrderStatus.PENDING_CONFIRMATION : OrderStatus.PAYMENT_PENDING;
  
  // Calculate payment deadline: created time + 7 days
  const paymentDeadline = new Date(new Date(createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    // Original fields
    id: baseOrder.id,
    name: baseOrder.name,
    phone: baseOrder.phone,
    address: baseOrder.address,
    note: baseOrder.note || '',
    
    // Item enrichment with inventory mode
    items: (baseOrder.items || []).map(item => ({
      ...item,
      inventoryMode: item.inventoryMode || 'standard',
      estimatedProduction: item.estimatedProduction || null
    })),
    
    // Pricing
    subtotal: baseOrder.subtotal,
    discountAmount: baseOrder.discountAmount,
    promoCode: baseOrder.promoCode || '',
    total: baseOrder.total,
    
    // Payment
    paymentType: baseOrder.paymentType || 'naqd',
    paymentScreenshot: baseOrder.paymentScreenshot || '',
    paymentStatus: baseOrder.paymentStatus || PaymentStatus.PENDING,
    paymentCollectedAt: baseOrder.paymentCollectedAt || null,
    paymentDeadline: baseOrder.paymentDeadline || paymentDeadline,
    
    // Status & History
    status: baseOrder.status || initialStatus,
    confirmedAt: baseOrder.confirmedAt || null,
    rejectedAt: baseOrder.rejectedAt || null,
    rejectionReason: baseOrder.rejectionReason || null,
    statusHistory: baseOrder.statusHistory || [
      {
        status: baseOrder.status || initialStatus,
        changedBy: 'system',
        changedAt: now,
        reason: 'Order created by customer'
      }
    ],
    
    // Timestamps
    createdAt: createdAt,
    updatedAt: baseOrder.updatedAt || now
  };
}

/**
 * Create a status history entry
 * @param {string} newStatus - New status value
 * @param {string} changedBy - User ID or 'system'
 * @param {string} reason - Reason for status change
 * @param {Object} metadata - Optional metadata (IP, user agent, etc.)
 * @returns {Object} Status history entry
 */
function createStatusHistoryEntry(newStatus, changedBy, reason, metadata = {}) {
  return {
    status: newStatus,
    changedBy: changedBy || 'system',
    changedAt: new Date().toISOString(),
    reason: reason || '',
    ...(Object.keys(metadata).length > 0 && { metadata })
  };
}

/**
 * Update order status with validation and history tracking
 * @param {Object} order - Order object to update
 * @param {string} newStatus - New status value
 * @param {string} changedBy - User ID or 'system'
 * @param {string} reason - Reason for change
 * @param {Object} options - Additional options
 * @returns {Object} Updated order or error object
 */
function updateOrderStatus(order, newStatus, changedBy, reason, options = {}) {
  // Validate transition
  if (!isValidStatusTransition(order.status, newStatus)) {
    return {
      success: false,
      error: `Status transition from ${order.status} to ${newStatus} is not allowed`,
      code: 'INVALID_TRANSITION'
    };
  }

  if (newStatus === order.status) return { success: true, order: { ...order } };
  if (newStatus === OrderStatus.PRODUCTION && order.paymentStatus !== PaymentStatus.COLLECTED && !options.paymentCollectedAt) {
    return { success: false, error: 'Record payment before starting production', code: 'PAYMENT_REQUIRED' };
  }
  const now = new Date().toISOString();
  const updatedOrder = { ...order };
  
  // Update primary status
  updatedOrder.status = newStatus;
  updatedOrder.updatedAt = now;
  
  // Record in history
  updatedOrder.statusHistory = [...(updatedOrder.statusHistory || [])];
  updatedOrder.statusHistory.push(
    createStatusHistoryEntry(newStatus, changedBy, reason, options.metadata)
  );
  
  // Handle special transitions
  if (newStatus === OrderStatus.CONFIRMED) {
    updatedOrder.confirmedAt = now;
  }
  
  if (newStatus === OrderStatus.REJECTED) {
    updatedOrder.rejectedAt = now;
    updatedOrder.rejectionReason = options.rejectionReason || reason;
  }
  
  if (newStatus === OrderStatus.PRODUCTION && options.paymentCollectedAt) {
    updatedOrder.paymentStatus = PaymentStatus.COLLECTED;
    updatedOrder.paymentCollectedAt = options.paymentCollectedAt || now;
  }
  
  return {
    success: true,
    order: updatedOrder
  };
}

/**
 * Record payment collection on an order
 * @param {Object} order - Order object
 * @param {string} changedBy - User/admin ID
 * @param {Object} paymentInfo - Payment information
 * @returns {Object} Updated order or error object
 */
function recordPaymentCollection(order, changedBy, paymentInfo = {}) {
  // Can only collect payment for confirmed/payment_pending orders
  if (![OrderStatus.CONFIRMED, OrderStatus.PAYMENT_PENDING].includes(order.status)) {
    return {
      success: false,
      error: `Cannot collect payment for order in ${order.status} status`,
      code: 'INVALID_STATUS_FOR_PAYMENT'
    };
  }

  const now = new Date().toISOString();
  const updatedOrder = { ...order };
  
  // Update payment status
  updatedOrder.paymentStatus = PaymentStatus.COLLECTED;
  updatedOrder.paymentCollectedAt = now;
  
  // Move to production status
  updatedOrder.status = OrderStatus.PRODUCTION;
  updatedOrder.updatedAt = now;
  
  // Record in history
  updatedOrder.statusHistory = [...(updatedOrder.statusHistory || [])];
  updatedOrder.statusHistory.push(
    createStatusHistoryEntry(
      OrderStatus.PRODUCTION,
      changedBy,
      'Payment collected, order moved to production',
      paymentInfo.metadata
    )
  );
  
  return {
    success: true,
    order: updatedOrder
  };
}

/**
 * Reject an order
 * @param {Object} order - Order object
 * @param {string} reason - Rejection reason (max 500 chars)
 * @param {string} changedBy - Admin user ID
 * @returns {Object} Updated order or error object
 */
function rejectOrder(order, reason, changedBy) {
  // Can only reject pending confirmation orders
  if (order.status !== OrderStatus.PENDING_CONFIRMATION) {
    return {
      success: false,
      error: `Can only reject orders in ${OrderStatus.PENDING_CONFIRMATION} status`,
      code: 'INVALID_STATUS_FOR_REJECTION'
    };
  }

  const now = new Date().toISOString();
  const updatedOrder = { ...order };
  
  // Update status
  updatedOrder.status = OrderStatus.REJECTED;
  updatedOrder.rejectedAt = now;
  updatedOrder.rejectionReason = reason.slice(0, 500); // Max 500 chars
  updatedOrder.updatedAt = now;
  
  // Record in history
  updatedOrder.statusHistory = [...(updatedOrder.statusHistory || [])];
  updatedOrder.statusHistory.push(
    createStatusHistoryEntry(
      OrderStatus.REJECTED,
      changedBy,
      `Rejected: ${reason}`
    )
  );
  
  return {
    success: true,
    order: updatedOrder
  };
}

/**
 * Confirm an order (move from pending_confirmation to confirmed)
 * @param {Object} order - Order object
 * @param {string} reason - Confirmation reason/notes
 * @param {string} changedBy - Admin user ID
 * @returns {Object} Updated order or error object
 */
function confirmOrder(order, reason, changedBy) {
  // Can only confirm pending orders
  if (order.status !== OrderStatus.PENDING_CONFIRMATION) {
    return {
      success: false,
      error: `Can only confirm orders in ${OrderStatus.PENDING_CONFIRMATION} status`,
      code: 'INVALID_STATUS_FOR_CONFIRMATION'
    };
  }

  const now = new Date().toISOString();
  const updatedOrder = { ...order };
  
  // Update status to CONFIRMED
  updatedOrder.status = OrderStatus.CONFIRMED;
  updatedOrder.confirmedAt = now;
  updatedOrder.paymentDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  updatedOrder.updatedAt = now;
  
  // Record in history
  updatedOrder.statusHistory = [...(updatedOrder.statusHistory || [])];
  updatedOrder.statusHistory.push(
    createStatusHistoryEntry(
      OrderStatus.CONFIRMED,
      changedBy,
      reason || 'Order confirmed by admin'
    )
  );
  
  return {
    success: true,
    order: updatedOrder
  };
}

/**
 * Get order timeline for display
 * @param {Object} order - Order object
 * @returns {Array} Array of timeline entries with display info
 */
function getOrderTimeline(order) {
  return (order.statusHistory || []).map(entry => ({
    status: entry.status,
    statusLabel: getStatusLabel(entry.status),
    changedAt: entry.changedAt,
    changedBy: entry.changedBy,
    reason: entry.reason,
    timestamp: new Date(entry.changedAt).getTime()
  })).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Validate order data for consistency
 * @param {Object} order - Order object to validate
 * @returns {Object} Validation result
 */
function validateOrderData(order) {
  const errors = [];
  
  // Check required fields
  if (!order.id) errors.push('Missing order ID');
  if (!order.name) errors.push('Missing customer name');
  if (!order.phone) errors.push('Missing phone');
  if (!order.address) errors.push('Missing address');
  if (!Array.isArray(order.items) || order.items.length === 0) {
    errors.push('Order must have at least one item');
  }
  
  // Check status validity
  if (order.status && !Object.values(OrderStatus).includes(order.status)) {
    errors.push(`Invalid status: ${order.status}`);
  }
  
  // Check payment status validity
  if (order.paymentStatus && !Object.values(PaymentStatus).includes(order.paymentStatus)) {
    errors.push(`Invalid payment status: ${order.paymentStatus}`);
  }
  
  // Check timeline consistency
  if (Array.isArray(order.statusHistory) && order.statusHistory.length > 0) {
    const firstEntry = order.statusHistory[0];
    if (!firstEntry.status) errors.push('Invalid status history entry');
  }
  
  // Check payment deadline format
  if (order.paymentDeadline) {
    try {
      new Date(order.paymentDeadline);
    } catch {
      errors.push('Invalid payment deadline format');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Migrate legacy order to extended schema
 * @param {Object} legacyOrder - Order without extended fields
 * @param {boolean} hasMadeToOrder - Whether order contains MTO items
 * @returns {Object} Extended order
 */
function migrateOrderToExtendedSchema(legacyOrder, hasMadeToOrder = false) {
  // If already migrated, return as-is
  if (legacyOrder.paymentStatus || legacyOrder.statusHistory) {
    return legacyOrder;
  }
  
  // Map old status to new status where applicable
  const statusMap = {
    'new': OrderStatus.PENDING_CONFIRMATION,
    'confirmed': OrderStatus.CONFIRMED,
    'shipped': OrderStatus.SHIPPED,
    'delivered': OrderStatus.DELIVERED,
    'cancelled': OrderStatus.CANCELLED
  };
  
  const mappedStatus = statusMap[legacyOrder.status] || OrderStatus.PAYMENT_PENDING;
  
  return initializeOrderWithExtendedSchema({
    ...legacyOrder,
    status: mappedStatus
  }, hasMadeToOrder);
}

// Export functions (Node.js/CommonJS)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OrderStatus,
    PaymentStatus,
    StatusTransitions,
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
  };
}
