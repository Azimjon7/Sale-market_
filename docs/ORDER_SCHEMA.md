# Extended Order Schema Documentation

## Overview

This document describes the extended order schema used in the Made-to-Order Inventory Upgrade. The schema includes comprehensive status tracking, payment management, and an immutable audit trail of all order changes.

## Schema Structure

### Core Order Object

```json
{
  "id": "ord_1702524600000",
  "name": "Azimjon Gulomov",
  "phone": "+998902008747",
  "address": "Andijan city, apartment 49",
  "note": "Delivery in the morning",
  
  "items": [
    {
      "productId": "prd_1234567890123",
      "name": "Product Name",
      "size": "M",
      "color": "Oq",
      "qty": 2,
      "price": 199000,
      "lineTotal": 398000,
      "inventoryMode": "standard",
      "estimatedProduction": null
    }
  ],
  
  "subtotal": 398000,
  "discountAmount": 39800,
  "promoCode": "SALE10",
  "total": 358200,
  
  "paymentType": "naqd",
  "paymentScreenshot": "",
  "paymentStatus": "pending",
  "paymentCollectedAt": null,
  "paymentDeadline": "2026-12-08T10:00:00.000Z",
  
  "status": "pending_confirmation",
  "confirmedAt": null,
  "rejectedAt": null,
  "rejectionReason": null,
  
  "statusHistory": [
    {
      "status": "pending_confirmation",
      "changedBy": "system",
      "changedAt": "2026-12-01T10:00:00.000Z",
      "reason": "Order created by customer",
      "metadata": {}
    },
    {
      "status": "confirmed",
      "changedBy": "admin_user_123",
      "changedAt": "2026-12-01T10:15:00.000Z",
      "reason": "Manually confirmed",
      "metadata": {}
    }
  ],
  
  "createdAt": "2026-12-01T10:00:00.000Z",
  "updatedAt": "2026-12-01T10:15:00.000Z"
}
```

## Field Reference

### Identification

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique order identifier (format: `ord_${timestamp}`) |
| `createdAt` | ISO 8601 | Order creation timestamp |
| `updatedAt` | ISO 8601 | Last modification timestamp |

### Customer Information

| Field | Type | Max Length | Description |
|-------|------|-----------|-------------|
| `name` | string | 120 chars | Customer full name |
| `phone` | string | 60 chars | Contact phone number |
| `address` | string | 260 chars | Delivery address |
| `note` | string | 600 chars | Special delivery instructions |

### Items

Each order contains an array of items:

| Field | Type | Description |
|-------|------|-------------|
| `productId` | string | Reference to product ID |
| `name` | string | Product name (captured at order time) |
| `size` | string | Selected variant size |
| `color` | string | Selected variant color |
| `qty` | number | Quantity ordered |
| `price` | number | Unit price (captured at order time) |
| `lineTotal` | number | `price × qty` |
| `inventoryMode` | enum | `"standard"` or `"made-to-order"` |
| `estimatedProduction` | ISO 8601 \| null | Estimated completion date for MTO items |

### Pricing

| Field | Type | Description |
|-------|------|-------------|
| `subtotal` | number | Sum of all item line totals |
| `discountAmount` | number | Amount deducted by promo code |
| `promoCode` | string | Promo code applied (if any) |
| `total` | number | `subtotal - discountAmount` |

### Payment

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `paymentType` | enum | `"naqd"`, `"karta"` | Cash or card payment |
| `paymentScreenshot` | string | File path | Payment receipt image |
| `paymentStatus` | enum | `"pending"`, `"collected"`, `"failed"` | Current payment status |
| `paymentCollectedAt` | ISO 8601 \| null | — | When payment was collected |
| `paymentDeadline` | ISO 8601 | — | Last moment to pay (default: `createdAt + 7 days`) |

### Status

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `status` | enum | See "Order Status Enum" below | Current order status |
| `confirmedAt` | ISO 8601 \| null | — | Admin confirmation timestamp |
| `rejectedAt` | ISO 8601 \| null | — | Rejection timestamp |
| `rejectionReason` | string \| null | Max 500 chars | Why order was rejected |

### Status History

| Field | Type | Description |
|-------|------|-------------|
| `statusHistory` | array | Array of status change records (immutable audit trail) |
| `.status` | enum | Status at this point |
| `.changedBy` | string | User ID or `"system"` |
| `.changedAt` | ISO 8601 | When status changed |
| `.reason` | string | Context/reason for change |
| `.metadata` | object | Optional additional info (IP, user agent, etc.) |

## Order Status Enum

Valid order statuses and allowed transitions:

```
pending_confirmation ──→ confirmed ──→ payment_pending ──→ production ──→ shipped ──→ delivered
                 ↓
              rejected ──→ cancelled
                 ↑
         (from any status at admin discretion)
```

### Status Values

- **`pending_confirmation`**: Order submitted, awaiting admin review. Payment NOT collected.
- **`confirmed`**: Admin approved order. Ready to collect payment.
- **`payment_pending`**: Payment collection in progress or awaited.
- **`production`**: Payment received, order in production.
- **`shipped`**: Order dispatched to customer.
- **`delivered`**: Order received by customer.
- **`rejected`**: Admin rejected order. No payment collected. Terminal state.
- **`cancelled`**: Order cancelled (usually from rejected state).

## Payment Status Enum

- **`pending`**: Payment not yet collected
- **`collected`**: Payment successfully received
- **`failed`**: Payment collection failed

## Helper Functions

### Core Functions

#### `initializeOrderWithExtendedSchema(baseOrder, hasMadeToOrder)`

Initialize a new order with all extended fields populated.

**Parameters:**
- `baseOrder`: Basic order object with id, name, phone, address, items, pricing
- `hasMadeToOrder`: Boolean indicating if order contains any made-to-order items

**Returns:** Complete order object with:
- Status set to `pending_confirmation` if `hasMadeToOrder=true`, else `payment_pending`
- Payment deadline calculated as `createdAt + 7 days`
- Initial status history entry
- Items enriched with `inventoryMode` and `estimatedProduction`

**Example:**
```javascript
const baseOrder = {
  id: 'ord_1702524600000',
  name: 'Ali Karimov',
  phone: '+998901234567',
  address: 'Tashkent',
  items: [{ productId: 'prd_123', qty: 1, price: 100000 }],
  subtotal: 100000,
  discountAmount: 0,
  promoCode: '',
  total: 100000
};

const order = initializeOrderWithExtendedSchema(baseOrder, true);
console.log(order.status); // 'pending_confirmation'
console.log(order.paymentDeadline); // ISO 8601 timestamp
```

#### `isValidStatusTransition(currentStatus, newStatus)`

Check if a status transition is allowed.

**Returns:** Boolean

**Example:**
```javascript
isValidStatusTransition('pending_confirmation', 'confirmed'); // true
isValidStatusTransition('shipped', 'production'); // false
```

#### `confirmOrder(order, reason, changedBy)`

Confirm a pending order (move to `confirmed` status).

**Parameters:**
- `order`: Order object in `pending_confirmation` status
- `reason`: Confirmation notes
- `changedBy`: Admin user ID

**Returns:** `{ success: boolean, order?: Order, error?: string, code?: string }`

**Example:**
```javascript
const result = confirmOrder(order, 'Confirmed with customer', 'admin_123');
if (result.success) {
  console.log('Order confirmed at:', result.order.confirmedAt);
}
```

#### `rejectOrder(order, reason, changedBy)`

Reject a pending order (move to `rejected` status).

**Parameters:**
- `order`: Order object in `pending_confirmation` status
- `reason`: Rejection reason (max 500 chars)
- `changedBy`: Admin user ID

**Returns:** `{ success: boolean, order?: Order, error?: string, code?: string }`

#### `recordPaymentCollection(order, changedBy, paymentInfo)`

Record payment collection and move order to production.

**Parameters:**
- `order`: Order object in `confirmed` or `payment_pending` status
- `changedBy`: Admin user ID
- `paymentInfo`: Optional payment metadata

**Returns:** `{ success: boolean, order?: Order, error?: string, code?: string }`

**Effect:**
- Sets `paymentStatus` to `"collected"`
- Sets `paymentCollectedAt` to current timestamp
- Moves order status to `"production"`
- Adds history entry

#### `updateOrderStatus(order, newStatus, changedBy, reason, options)`

Generic status update with validation.

**Parameters:**
- `order`: Order object
- `newStatus`: Target status
- `changedBy`: User making change
- `reason`: Change reason
- `options`: Additional options (metadata, rejectionReason, etc.)

**Returns:** `{ success: boolean, order?: Order, error?: string, code?: string }`

#### `createStatusHistoryEntry(newStatus, changedBy, reason, metadata)`

Create a single status history entry.

**Returns:** Entry object

#### `getOrderTimeline(order)`

Get formatted timeline of all status changes.

**Returns:** Array of timeline entries with `status`, `statusLabel`, `changedAt`, `changedBy`, `reason`, sorted chronologically

#### `validateOrderData(order)`

Validate order data for required fields and format.

**Returns:** `{ valid: boolean, errors: string[] }`

#### `getStatusLabel(status)`

Get Uzbek language status label.

**Returns:** Uzbek status string

**Example:**
```javascript
getStatusLabel('pending_confirmation'); // 'Tasdiqlashni kutmoqda'
getStatusLabel('confirmed'); // 'Tasdiqlandi'
```

#### `migrateOrderToExtendedSchema(legacyOrder)`

Migrate legacy order (without extended fields) to new schema.

**Returns:** Extended order object

## Migration

All existing orders are automatically migrated to the extended schema when the system starts. The migration:

1. **Backs up** original `data/orders.json` to `data/backups/`
2. **Maps** old status values to new enum values
3. **Enriches** items with `inventoryMode` and `estimatedProduction` fields
4. **Creates** initial status history entries
5. **Preserves** all existing data

Run manually with:
```bash
node scripts/migrate-orders-to-extended-schema.js
```

## Backward Compatibility

The extended schema is backward compatible:
- Existing orders continue to work
- All new fields are optional or populated with sensible defaults
- Legacy endpoints that don't use new fields continue to function
- Migration is idempotent (safe to run multiple times)

## Validation Rules

### Required Fields
- `id`, `name`, `phone`, `address`, `items` (non-empty array)
- `subtotal`, `discountAmount`, `promoCode`, `total`
- `paymentType`, `status`, `paymentStatus`, `statusHistory`

### Format Constraints
- Phone: Valid Uzbek format (+998XXXXXXXXX)
- Address: 5-500 characters
- Note: 0-600 characters
- Rejection reason: 0-500 characters
- Status: Must be valid enum value
- Payment status: Must be valid enum value
- Dates: ISO 8601 format

### State Constraints
- Status transitions must follow defined allowed transitions
- Payment can only be collected for `confirmed` or `payment_pending` orders
- Orders can only be rejected while in `pending_confirmation` status
- Timeline entries must be in chronological order

## Usage Examples

### Create a New Order

```javascript
const { initializeOrderWithExtendedSchema } = require('./js/order-schema');

const newOrder = initializeOrderWithExtendedSchema({
  id: `ord_${Date.now()}`,
  name: 'Ali Karimov',
  phone: '+998901234567',
  address: 'Tashkent City',
  items: [
    {
      productId: 'prd_1',
      qty: 2,
      price: 150000,
      inventoryMode: 'made-to-order'
    }
  ],
  subtotal: 300000,
  discountAmount: 30000,
  promoCode: 'SAVE10',
  total: 270000
}, true); // true = contains MTO items
```

### Confirm a Pending Order

```javascript
const { confirmOrder } = require('./js/order-schema');

const result = confirmOrder(
  order,
  'Confirmed - stock verified',
  'admin_user_123'
);

if (result.success) {
  // Save updated order
  saveOrder(result.order);
}
```

### Record Payment

```javascript
const { recordPaymentCollection } = require('./js/order-schema');

const result = recordPaymentCollection(
  order,
  'admin_user_123',
  { method: 'cash', amount: 270000 }
);

if (result.success) {
  // Order now in production status
  saveOrder(result.order);
}
```

### Get Order Timeline

```javascript
const { getOrderTimeline } = require('./js/order-schema');

const timeline = getOrderTimeline(order);
timeline.forEach(entry => {
  console.log(`${entry.statusLabel} - ${entry.changedAt} by ${entry.changedBy}`);
});
```

## Files Reference

- **`js/order-schema.js`**: Core module with all helper functions
- **`scripts/migrate-orders-to-extended-schema.js`**: Migration script
- **`scripts/validate-order-schema.js`**: Validation test suite
- **`test/order-schema.test.js`**: Jest test suite (for future use)
- **`docs/ORDER_SCHEMA.md`**: This documentation

## See Also

- `requirements.md` - Full requirements for made-to-order upgrade
- `design.md` - Complete design specification
- `tasks.md` - Implementation task list
