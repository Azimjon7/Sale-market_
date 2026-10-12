'use strict';

const { integer } = require('./inventoryValidator');

const MOVEMENT_TYPES = Object.freeze([
  'initial_setup', 'order_reserved', 'order_committed', 'order_restored', 'admin_adjustment',
]);

function getStockHistory(product, filters = {}) {
  let history = Array.isArray(product && product.stockHistory) ? product.stockHistory.slice() : [];
  if (filters.startDate) {
    const start = new Date(filters.startDate);
    if (!Number.isNaN(start.getTime())) history = history.filter(item => new Date(item.timestamp) >= start);
  }
  if (filters.endDate) {
    const end = new Date(filters.endDate);
    if (!Number.isNaN(end.getTime())) history = history.filter(item => new Date(item.timestamp) <= end);
  }
  if (filters.type && MOVEMENT_TYPES.includes(filters.type)) history = history.filter(item => item.type === filters.type);
  return history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function generateAuditReport(product, startDate, endDate) {
  const history = getStockHistory(product, { startDate, endDate });
  return {
    productId: product.id,
    productName: product.name,
    reportPeriod: { startDate, endDate },
    statistics: {
      totalMovements: history.length,
      totalDeductions: history.filter(item => item.change < 0).reduce((sum, item) => sum + Math.abs(item.change), 0),
      totalRestorations: history.filter(item => item.change > 0).reduce((sum, item) => sum + item.change, 0),
      adminAdjustments: history.filter(item => item.type === 'admin_adjustment').length,
      currentBalance: integer(product.available),
    },
    history,
  };
}

module.exports = { MOVEMENT_TYPES, getStockHistory, generateAuditReport };
