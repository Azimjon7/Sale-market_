(function (root, factory) {
  const labels = factory();
  if (typeof module === 'object' && module.exports) module.exports = labels;
  else root.DodolaOrderLabels = labels;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const statusLabels = Object.freeze({
    new: 'Yangi',
    pending_confirmation: 'Tasdiqlashni kutmoqda',
    confirmed: 'Tasdiqlandi',
    payment_pending: "To'lov kutilmoqda",
    production: 'Tayyorlanmoqda',
    shipped: "Jo'natildi",
    delivered: 'Yetkazildi',
    rejected: 'Rad etildi',
    cancelled: 'Bekor qilindi',
  });

  const paymentLabels = Object.freeze({
    pending: "To'lov kutilmoqda",
    collected: "To'lov tasdiqlangan",
    failed: "To'lov amalga oshmadi",
  });

  const paymentMethodLabels = Object.freeze({
    karta: "Karta orqali",
    naqd: "Naqd",
  });

  const reasonLabels = Object.freeze({
    'Order created by customer': 'Buyurtma mijoz tomonidan yaratildi',
    'Existing order before audited transition': 'Audit tarixi joriy etilishidan oldingi buyurtma',
    'Status updated by admin': 'Holat administrator tomonidan yangilandi',
    'Payment collected and production started': "To'lov qayd etildi va tayyorlash boshlandi",
    'Order confirmed by admin': 'Buyurtma administrator tomonidan tasdiqlandi',
  });

  function status(value) {
    return statusLabels[String(value || '').trim()] || 'Holat ko\'rsatilmagan';
  }

  function payment(value) {
    return paymentLabels[String(value || 'pending').trim()] || "To'lov holati ko'rsatilmagan";
  }

  function paymentMethod(value) {
    return paymentMethodLabels[String(value || 'naqd').trim().toLowerCase()] || "Ko'rsatilmagan";
  }

  function actor(value) {
    const text = String(value || '').trim();
    if (!text) return "Ko'rsatilmagan";
    if (text === 'system') return 'Tizim';
    return text;
  }

  function reason(value) {
    const text = String(value || '').trim();
    return reasonLabels[text] || text || 'Sabab ko\'rsatilmagan';
  }

  function actionError(value) {
    const text = String(value || '');
    if (/not found/i.test(text)) return 'Buyurtma topilmadi.';
    if (/reason/i.test(text)) return 'Rad etish sababini 1–500 belgi oralig\'ida kiriting.';
    if (/already rejected/i.test(text)) return 'Buyurtma avval rad etilgan.';
    if (/payment provider|online payment/i.test(text)) return "Onlayn to'lovni faqat to'lov provayderi tasdiqlashi mumkin.";
    if (/record payment|payment required/i.test(text)) return "Tayyorlashni boshlashdan oldin to'lov tasdiqlanishi kerak.";
    if (/transition|invalid order status/i.test(text)) return "Tanlangan holatga o'tishga ruxsat berilmagan.";
    return 'Amalni bajarib bo\'lmadi. Qayta urinib ko\'ring.';
  }

  return { statusLabels, paymentLabels, status, payment, paymentMethod, actor, reason, actionError };
});
