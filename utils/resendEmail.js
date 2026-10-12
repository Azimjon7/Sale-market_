'use strict';

const { Resend } = require('resend');

class EmailConfigurationError extends Error {
  constructor(message) { super(message); this.name = 'EmailConfigurationError'; this.code = 'email_not_configured'; }
}

class EmailDeliveryError extends Error {
  constructor(message) { super(message); this.name = 'EmailDeliveryError'; this.code = 'email_delivery_failed'; }
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().replace(/\/$/, '');
  } catch { return ''; }
}

function createResendEmailService(options = {}) {
  const apiKey = String(options.apiKey ?? process.env.RESEND_API_KEY ?? '').trim();
  const from = String(options.from ?? process.env.EMAIL_FROM ?? '').trim();
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.AUTH_BASE_URL);
  const testRecipient = String(options.testRecipient ?? process.env.RESEND_TEST_RECIPIENT ?? '').trim().toLowerCase();
  const usingTestSender = /@resend\.dev(?:>|\s|$)/i.test(from);
  const missing = [];
  if (!apiKey) missing.push('RESEND_API_KEY');
  if (!from) missing.push('EMAIL_FROM');
  if (!baseUrl) missing.push('AUTH_BASE_URL');
  if (usingTestSender && !testRecipient) missing.push('RESEND_TEST_RECIPIENT');
  const configured = missing.length === 0;
  let client = options.client || null;

  const status = () => ({ configured, provider: 'resend', missing: [...missing], testMode: usingTestSender });
  const send = async ({ to, subject, text, html }) => {
    if (!configured) throw new EmailConfigurationError('Email xizmati to‘liq sozlanmagan.');
    const recipient = String(to || '').trim();
    if (usingTestSender && recipient.toLowerCase() !== testRecipient) {
      throw new EmailDeliveryError('Sinov yuboruvchisi faqat ruxsat etilgan test manziliga xat yuboradi.');
    }
    if (!client) client = new Resend(apiKey);
    let response;
    try {
      response = await client.emails.send({ from, to: [recipient], subject, text, html });
    } catch {
      throw new EmailDeliveryError('Email provayderiga ulanishda xatolik yuz berdi.');
    }
    if (!response || response.error || !response.data || !response.data.id) {
      throw new EmailDeliveryError('Resend xatni yuborish uchun qabul qilmadi.');
    }
    return { accepted: true, provider: 'resend', id: response.data.id };
  };

  return { send, status, baseUrl };
}

module.exports = { createResendEmailService, normalizeBaseUrl, EmailConfigurationError, EmailDeliveryError };
