'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { readJSON, writeJSON } = require('./jsonStore');
const { withIdentifierLock } = require('./identifierStore');
const { verificationEmail, passwordResetEmail } = require('./emailTemplates');
const { createResendEmailService, EmailDeliveryError } = require('./resendEmail');

const clean = (value, max = 200) => String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
const normalizePhone = value => { const digits = String(value || '').replace(/\D/g, ''); return digits.length === 12 && digits.startsWith('998') ? '+' + digits : ''; };
const email = value => clean(value, 254).toLowerCase();
const tokenHash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const safeCustomer = row => ({ id: row.id, firstName: row.firstName, lastName: row.lastName, phone: row.phone, phoneVerified: false,
  email: row.email, emailVerified: Boolean(row.emailVerifiedAt), addresses: Array.isArray(row.addresses) ? row.addresses : [], createdAt: row.createdAt });
const strongPassword = value => typeof value === 'string' && value.length >= 10 && value.length <= 128 && /[A-Za-z]/.test(value) && /\d/.test(value);

function installCustomerAuth(app, options) {
  const { dataDir, customersFile, tokensFile, ordersFile, jwt, jwtSecret, adminUsername, adminPassword, credentialsEqual } = options;
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
    message: { message: "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring." } });
  const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
    message: { message: "Juda ko'p so'rov yuborildi. Keyinroq qayta urinib ko'ring." } });
  const resendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false,
    message: { message: "Tasdiqlash xati juda ko‘p so‘raldi. Bir soatdan keyin qayta urinib ko‘ring." } });
  const customerRepository = options.customerRepository || null;
  const getById = id => customerRepository ? customerRepository.findById(id) : Promise.resolve(readJSON(customersFile, []).find(row => row.id === id) || null);
  const getByPhone = phone => customerRepository ? customerRepository.findByPhone(phone) : Promise.resolve(readJSON(customersFile, []).find(row => row.phone === phone) || null);
  const getByEmail = mail => customerRepository ? customerRepository.findByEmail(mail) : Promise.resolve(readJSON(customersFile, []).find(row => row.email === mail) || null);
  const requireCustomer = async (req, res, next) => {
    try {
    if (!req.session || !req.session.customerId) return res.status(401).json({ message: 'Kabinetga kirish talab qilinadi.' });
    const customer = await getById(req.session.customerId);
    if (!customer || customer.sessionVersion !== req.session.sessionVersion) return req.session.destroy(() => res.status(401).json({ message: 'Sessiya yakunlangan. Qayta kiring.' }));
    req.customer = customer; next();
    } catch (error) { next(error); }
  };
  const csrf = (req, res, next) => req.session && req.get('X-CSRF-Token') === req.session.csrfToken ? next() : res.status(403).json({ message: "Xavfsizlik tasdig'i yaroqsiz. Sahifani yangilang." });
  const ensureCsrf = req => req.session.csrfToken || (req.session.csrfToken = crypto.randomBytes(24).toString('base64url'));
  const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  const emailService = options.emailService || (options.emailSender ? {
    baseUrl: process.env.AUTH_BASE_URL || '',
    status: () => ({ configured: true, provider: 'injected', testMode: true }),
    send: async message => {
      const result = await options.emailSender(message);
      if (result === false) throw new EmailDeliveryError('Email xizmati xatni qabul qilmadi.');
      return { accepted: true, provider: 'injected', id: 'injected' };
    }
  } : createResendEmailService());

  async function createToken(customer, type, minutes) {
    const raw = crypto.randomBytes(32).toString('base64url');
    const hash = tokenHash(raw);
    if (customerRepository) {
      await customerRepository.issueToken({ customerId: customer.id, type, tokenHash: hash, expiresAt: new Date(Date.now() + minutes * 60000) });
    } else await withIdentifierLock(dataDir, async () => {
      const records = readJSON(tokensFile, []); records.push({ id: crypto.randomUUID(), customerId: customer.id, type, tokenHash: hash,
        expiresAt: new Date(Date.now() + minutes * 60000).toISOString(), usedAt: null, createdAt: new Date().toISOString() }); writeJSON(tokensFile, records);
    });
    return { raw, hash };
  }
  async function finalizeTokenDelivery(customerId, type, currentHash, accepted) {
    if (customerRepository) return customerRepository.invalidateIssuedToken(customerId, type, currentHash, accepted);
    await withIdentifierLock(dataDir, async () => {
      const records = readJSON(tokensFile, []), now = new Date().toISOString();
      records.forEach(record => {
        if (record.customerId !== customerId || record.type !== type || record.usedAt) return;
        if (!accepted && record.tokenHash === currentHash) record.usedAt = now;
        if (accepted && record.tokenHash !== currentHash) record.usedAt = now;
      });
      writeJSON(tokensFile, records);
    });
  }
  const authBaseUrl = String(emailService.baseUrl || process.env.AUTH_BASE_URL || '').replace(/\/$/, '');
  const verificationLink = raw => `${authBaseUrl}/auth.html?verify=${encodeURIComponent(raw)}`;
  const resetLink = raw => `${authBaseUrl}/reset-password.html?token=${encodeURIComponent(raw)}`;
  async function sendVerification(customer) {
    const issued = await createToken(customer, 'verify_email', 24 * 60);
    const template = verificationEmail({ firstName: customer.firstName, actionUrl: verificationLink(issued.raw) });
    try {
      const result = await emailService.send({ to: customer.email, ...template });
      await finalizeTokenDelivery(customer.id, 'verify_email', issued.hash, true);
      return result;
    } catch (error) {
      await finalizeTokenDelivery(customer.id, 'verify_email', issued.hash, false);
      throw error;
    }
  }
  async function sendPasswordReset(customer) {
    const issued = await createToken(customer, 'reset_password', 30);
    const template = passwordResetEmail({ firstName: customer.firstName, actionUrl: resetLink(issued.raw) });
    try {
      const result = await emailService.send({ to: customer.email, ...template });
      await finalizeTokenDelivery(customer.id, 'reset_password', issued.hash, true);
      return result;
    } catch (error) {
      await finalizeTokenDelivery(customer.id, 'reset_password', issued.hash, false);
      throw error;
    }
  }
  function adminFromBearer(req) { try { const value = String(req.get('Authorization') || ''); if (!value.startsWith('Bearer ')) return false; const payload = jwt.verify(value.slice(7), jwtSecret); return payload.role === 'admin'; } catch { return false; } }

  app.get('/api/auth/session', route(async (req, res) => {
    const csrfToken = ensureCsrf(req);
    if (adminFromBearer(req)) return res.json({ authenticated: true, role: 'admin', redirect: '/admin.html', csrfToken });
    if (!req.session.customerId) return res.json({ authenticated: false, role: null, redirect: '/auth.html', csrfToken });
    const customer = await getById(req.session.customerId);
    if (!customer || customer.sessionVersion !== req.session.sessionVersion) return req.session.destroy(() => res.json({ authenticated: false, role: null, redirect: '/auth.html', csrfToken: null }));
    res.json({ authenticated: true, role: 'customer', redirect: '/account.html', customer: safeCustomer(customer), csrfToken });
  }));

  app.post('/api/auth/register', authLimiter, csrf, async (req, res, next) => {
    try {
      const firstName = clean(req.body.firstName, 80), lastName = clean(req.body.lastName, 80), phone = normalizePhone(req.body.phone), mail = email(req.body.email), password = req.body.password;
      if (!firstName || !lastName || !phone || !/^\S+@\S+\.\S+$/.test(mail) || !strongPassword(password) || password !== req.body.confirmPassword)
        return res.status(400).json({ message: "Ma'lumotlarni tekshiring. Parol kamida 10 belgi, harf va raqamdan iborat bo'lsin." });
      let customer;
      const input = { id: 'cus_' + crypto.randomUUID(), firstName, lastName, phone, phoneVerified: false, email: mail, emailVerifiedAt: null,
        passwordHash: await bcrypt.hash(password, 12), addresses: [], sessionVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (customerRepository) {
        if (await getByPhone(phone) || await getByEmail(mail)) throw Object.assign(new Error('Bu telefon yoki email allaqachon ro‘yxatdan o‘tgan.'), { status: 409 });
        try { customer = await customerRepository.createCustomer(input); }
        catch (error) { if (error.code === '23505') throw Object.assign(new Error('Bu telefon yoki email allaqachon ro‘yxatdan o‘tgan.'), { status: 409 }); throw error; }
      } else await withIdentifierLock(dataDir, async () => { const rows = readJSON(customersFile, []); if (rows.some(row => row.phone === phone || row.email === mail)) throw Object.assign(new Error('Bu telefon yoki email allaqachon ro‘yxatdan o‘tgan.'), { status: 409 }); customer = input; rows.push(customer); writeJSON(customersFile, rows); });
      const emailState = emailService.status();
      if (!emailState.configured) return res.status(201).json({ success: true, emailDeliveryState: 'not_configured', message: 'Hisob yaratildi, ammo email xizmati sozlanmagan. Tasdiqlash xati yuborilmadi.' });
      try {
        await sendVerification(customer);
        return res.status(201).json({ success: true, emailDeliveryState: 'accepted', message: 'Hisob yaratildi. Tasdiqlash havolasi yuborish uchun qabul qilindi.' });
      } catch {
        return res.status(201).json({ success: true, emailDeliveryState: 'failed', message: 'Hisob yaratildi, ammo tasdiqlash xatini yuborib bo‘lmadi. Kabinetdan qayta urinishingiz mumkin.' });
      }
    } catch (error) { if (error.status) return res.status(error.status).json({ message: error.message }); next(error); }
  });

  app.post('/api/auth/login', authLimiter, csrf, async (req, res, next) => {
    try {
      const identifier = clean(req.body.identifier, 254), password = String(req.body.password || '');
      if (credentialsEqual(identifier, adminUsername) && credentialsEqual(password, adminPassword)) {
        const adminToken = jwt.sign({ username: adminUsername, role: 'admin' }, jwtSecret, { expiresIn: '24h' });
        return res.json({ success: true, role: 'admin', redirect: '/admin.html', adminToken });
      }
      const phone = normalizePhone(identifier); const customer = phone && await getByPhone(phone);
      if (!customer || !(await bcrypt.compare(password, customer.passwordHash))) return res.status(401).json({ message: 'Telefon raqami yoki parol noto‘g‘ri.' });
      req.session.regenerate(error => { if (error) return next(error); req.session.customerId = customer.id; req.session.sessionVersion = customer.sessionVersion; req.session.csrfToken = crypto.randomBytes(24).toString('base64url'); req.session.save(err => err ? next(err) : res.json({ success: true, role: 'customer', redirect: '/account.html', customer: safeCustomer(customer), csrfToken: req.session.csrfToken })); });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', csrf, (req, res, next) => req.session.destroy(error => error ? next(error) : res.clearCookie('dodola_customer').json({ success: true })));

  app.post('/api/auth/verify-email', authLimiter, csrf, route(async (req, res) => {
    const hash = tokenHash(req.body.token), now = new Date(); let success = false;
    if (customerRepository) success = await customerRepository.consumeEmailVerification(hash);
    else await withIdentifierLock(dataDir, async () => { const tokens = readJSON(tokensFile, []), record = tokens.find(row => row.type === 'verify_email' && row.tokenHash === hash && !row.usedAt); if (!record || new Date(record.expiresAt) <= now) return;
      const customers = readJSON(customersFile, []), customer = customers.find(row => row.id === record.customerId); if (!customer) return; record.usedAt = now.toISOString(); customer.emailVerifiedAt = now.toISOString(); customer.updatedAt = now.toISOString(); writeJSON(tokensFile, tokens); writeJSON(customersFile, customers); success = true; });
    res.status(success ? 200 : 400).json({ success, message: success ? 'Email tasdiqlandi.' : 'Tasdiqlash havolasi yaroqsiz yoki muddati tugagan.' });
  }));
  app.post('/api/auth/resend-verification', resendLimiter, requireCustomer, csrf, route(async (req, res) => {
    if (req.customer.emailVerifiedAt) return res.json({ success: true, emailDeliveryState: 'already_verified', message: 'Email allaqachon tasdiqlangan.' });
    if (!emailService.status().configured) return res.status(503).json({ success: false, emailDeliveryState: 'not_configured', message: 'Email xizmati hozircha sozlanmagan.' });
    const recent = customerRepository ? await customerRepository.hasRecentToken(req.customer.id, 'verify_email', new Date(Date.now() - 60000))
      : readJSON(tokensFile, []).some(record => record.customerId === req.customer.id && record.type === 'verify_email' && !record.usedAt && Date.now() - new Date(record.createdAt).getTime() < 60 * 1000);
    if (recent) return res.status(429).json({ success: false, emailDeliveryState: 'rate_limited', message: 'Yangi xat so‘rashdan oldin bir daqiqa kuting.' });
    try {
      await sendVerification(req.customer);
      res.json({ success: true, emailDeliveryState: 'accepted', message: 'Tasdiqlash xati yuborish uchun qabul qilindi.' });
    } catch {
      res.status(502).json({ success: false, emailDeliveryState: 'failed', message: 'Tasdiqlash xatini yuborib bo‘lmadi. Keyinroq qayta urinib ko‘ring.' });
    }
  }));
  app.post('/api/auth/forgot-password', resetLimiter, csrf, route(async (req, res) => {
    if (!emailService.status().configured) return res.status(503).json({ success: false, emailDeliveryState: 'not_configured', message: 'Email xizmati hozircha sozlanmagan.' });
    const generic = { success: true, emailDeliveryState: 'accepted', message: "Agar tasdiqlangan hisob mavjud bo‘lsa, tiklash xati yuborish uchun qabul qilindi." }, mail = email(req.body.email);
    const customer = await getByEmail(mail); if (!customer || !customer.emailVerifiedAt) return res.json(generic);
    try { await sendPasswordReset(customer); res.json(generic); }
    catch { res.status(502).json({ success: false, emailDeliveryState: 'failed', message: 'Tiklash xatini yuborib bo‘lmadi. Keyinroq qayta urinib ko‘ring.' }); }
  }));
  app.post('/api/auth/reset-password', resetLimiter, csrf, route(async (req, res) => {
    if (!strongPassword(req.body.password) || req.body.password !== req.body.confirmPassword) return res.status(400).json({ message: 'Yangi parol talabga javob bermaydi.' });
    const hash = tokenHash(req.body.token), now = new Date(); let success = false;
    if (customerRepository) success = await customerRepository.consumePasswordReset(hash, await bcrypt.hash(req.body.password, 12));
    else await withIdentifierLock(dataDir, async () => { const tokens = readJSON(tokensFile, []), record = tokens.find(row => row.type === 'reset_password' && row.tokenHash === hash && !row.usedAt); if (!record || new Date(record.expiresAt) <= now) return;
      const customers = readJSON(customersFile, []), customer = customers.find(row => row.id === record.customerId && row.emailVerifiedAt); if (!customer) return; customer.passwordHash = await bcrypt.hash(req.body.password, 12); customer.sessionVersion += 1; customer.updatedAt = now.toISOString(); record.usedAt = now.toISOString(); writeJSON(customersFile, customers); writeJSON(tokensFile, tokens); success = true; });
    res.status(success ? 200 : 400).json({ success, message: success ? 'Parol yangilandi. Qayta kiring.' : 'Tiklash havolasi yaroqsiz yoki muddati tugagan.' });
  }));

  app.get('/api/customer/profile', requireCustomer, route(async (req, res) => { const row = await getById(req.session.customerId); row ? res.json({ customer: safeCustomer(row), csrfToken: ensureCsrf(req) }) : res.sendStatus(401); }));
  app.patch('/api/customer/profile', requireCustomer, csrf, route(async (req, res) => { let updated; if (customerRepository) updated = safeCustomer(await customerRepository.updateProfile(req.session.customerId, { firstName: clean(req.body.firstName, 80), lastName: clean(req.body.lastName, 80) })); else await withIdentifierLock(dataDir, async () => { const rows = readJSON(customersFile, []), row = rows.find(item => item.id === req.session.customerId); row.firstName = clean(req.body.firstName, 80) || row.firstName; row.lastName = clean(req.body.lastName, 80) || row.lastName; row.updatedAt = new Date().toISOString(); writeJSON(customersFile, rows); updated = safeCustomer(row); }); res.json({ success: true, customer: updated }); }));
  app.put('/api/customer/addresses', requireCustomer, csrf, route(async (req, res) => { let addresses; const address = { id: req.body.id || crypto.randomUUID(), label: clean(req.body.label, 60), address: clean(req.body.address, 500) }; if (!address.label || address.address.length < 5) throw Object.assign(new Error('Manzil ma’lumotlarini to‘ldiring.'), { status: 400 }); if (customerRepository) addresses = await customerRepository.putAddress(req.session.customerId, address); else await withIdentifierLock(dataDir, async () => { const rows = readJSON(customersFile, []), row = rows.find(item => item.id === req.session.customerId); const index = row.addresses.findIndex(item => item.id === address.id); if (index < 0) row.addresses.push(address); else row.addresses[index] = address; writeJSON(customersFile, rows); addresses = row.addresses; }); res.json({ success: true, addresses }); }));
  app.delete('/api/customer/addresses/:id', requireCustomer, csrf, route(async (req, res) => { let addresses; if (customerRepository) addresses = await customerRepository.deleteAddress(req.session.customerId, req.params.id); else await withIdentifierLock(dataDir, async () => { const rows = readJSON(customersFile, []), row = rows.find(item => item.id === req.session.customerId); row.addresses = row.addresses.filter(item => item.id !== req.params.id); writeJSON(customersFile, rows); addresses = row.addresses; }); res.json({ success: true, addresses }); }));
  app.post('/api/customer/change-password', requireCustomer, csrf, route(async (req, res) => {
    if (!strongPassword(req.body.newPassword)) return res.status(400).json({ message: 'Joriy yoki yangi parol noto‘g‘ri.' });
    let changed = false;
    const row = await getById(req.session.customerId);
    if (customerRepository) {
      if (row && await bcrypt.compare(String(req.body.currentPassword || ''), row.passwordHash)) {
        changed = await customerRepository.changePassword(row.id, await bcrypt.hash(req.body.newPassword, 12));
      }
    } else await withIdentifierLock(dataDir, async () => {
      const rows = readJSON(customersFile, []), row = rows.find(item => item.id === req.session.customerId);
      if (!row || !(await bcrypt.compare(String(req.body.currentPassword || ''), row.passwordHash))) return;
      row.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
      row.sessionVersion += 1;
      row.updatedAt = new Date().toISOString();
      writeJSON(customersFile, rows);
      changed = true;
    });
    if (!changed) return res.status(400).json({ message: 'Joriy yoki yangi parol noto‘g‘ri.' });
    req.session.destroy(() => res.clearCookie('dodola_customer').json({ success: true, message: 'Parol yangilandi. Qayta kiring.' }));
  }));
  app.get('/api/customer/orders', requireCustomer, route(async (req, res) => { const orders = customerRepository ? await customerRepository.listOrders(req.session.customerId) : readJSON(ordersFile, []).filter(row => row.customerId === req.session.customerId).map(row => ({ id: row.id, orderNumber: row.orderNumber, items: row.items, total: row.total, status: row.status, paymentStatus: row.paymentStatus, createdAt: row.createdAt })); res.json({ orders }); }));
  return { requireCustomer, csrf };
}
module.exports = { installCustomerAuth, normalizePhone, strongPassword, tokenHash };
