'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createResendEmailService } = require('../utils/resendEmail');
const { verificationEmail, passwordResetEmail } = require('../utils/emailTemplates');

function mockClient(response = { data: { id: 'email_mock_1' }, error: null }) {
  const calls = [];
  return {
    calls,
    emails: { send: async payload => { calls.push(payload); return response; } }
  };
}

test('Resend client receives branded HTML and plain text without the API key', async () => {
  const client = mockClient();
  const service = createResendEmailService({
    apiKey: 're_mock_secret_never_send',
    from: 'Dodola <xatlar@dodola.uz>',
    baseUrl: 'https://dodola.uz',
    client
  });
  const template = verificationEmail({ firstName: 'Aziza', actionUrl: 'https://dodola.uz/auth.html?verify=safe-token' });
  const result = await service.send({ to: 'aziza@example.uz', ...template });
  assert.equal(result.accepted, true);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].from, 'Dodola <xatlar@dodola.uz>');
  assert.deepEqual(client.calls[0].to, ['aziza@example.uz']);
  assert.match(client.calls[0].html, /Email manzilingizni tasdiqlang/);
  assert.match(client.calls[0].text, /24 soat/);
  assert.doesNotMatch(JSON.stringify(client.calls[0]), /re_mock_secret_never_send/);
});

test('missing Resend configuration is reported without making a request', async () => {
  const client = mockClient();
  const service = createResendEmailService({ apiKey: '', from: '', baseUrl: '', client });
  assert.equal(service.status().configured, false);
  assert.deepEqual(service.status().missing.sort(), ['AUTH_BASE_URL', 'EMAIL_FROM', 'RESEND_API_KEY']);
  await assert.rejects(() => service.send({ to: 'a@example.uz', subject: 'Sinov', text: 'Sinov', html: '<p>Sinov</p>' }), error => error.code === 'email_not_configured');
  assert.equal(client.calls.length, 0);
});

test('Resend test sender allows only the configured permitted recipient', async () => {
  const client = mockClient();
  const service = createResendEmailService({
    apiKey: 're_mock',
    from: 'Dodola <onboarding@resend.dev>',
    baseUrl: 'http://localhost:3000',
    testRecipient: 'owner@example.com',
    client
  });
  const template = passwordResetEmail({ firstName: 'Ali', actionUrl: 'http://localhost:3000/reset-password.html?token=safe-token' });
  await assert.rejects(() => service.send({ to: 'other@example.com', ...template }), error => error.code === 'email_delivery_failed');
  await service.send({ to: 'OWNER@example.com', ...template });
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].html, /Yangi parol o‘rnatish/);
  assert.match(client.calls[0].text, /30 daqiqa/);
});

test('Resend provider rejection is surfaced as a delivery failure', async () => {
  const service = createResendEmailService({
    apiKey: 're_mock', from: 'Dodola <xatlar@dodola.uz>', baseUrl: 'https://dodola.uz',
    client: mockClient({ data: null, error: { message: 'rejected' } })
  });
  await assert.rejects(() => service.send({ to: 'a@example.uz', subject: 'Sinov', text: 'Sinov', html: '<p>Sinov</p>' }), error => error.code === 'email_delivery_failed' && !error.message.includes('re_mock'));
});
