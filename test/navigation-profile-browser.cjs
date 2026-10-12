'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const bcrypt = require('bcryptjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { initializeProductInventory } = require('../utils/stockReservation');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'navigation-browser-secret-at-least-32-chars';
process.env.ADMIN_USERNAME = 'navigation-admin';
process.env.ADMIN_PASSWORD = 'navigation-admin-password';
const { createApp } = require('../server');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, '.local-tests', 'navigation-profile-' + crypto.randomUUID());
const dataDir = path.join(fixture, 'data');
const uploadsDir = path.join(fixture, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(dataDir, name + '.json'), JSON.stringify(value, null, 2));
const product = initializeProductInventory({ id: 'nav-product', sku: 'DOD-0001', name: 'Navigatsiya sinov mahsuloti', price: 125000, category: 'Sinov', desc: 'Brauzer testi', image: 'img/placeholders/product.svg', images: ['img/placeholders/product.svg'], colors: ['Qora'], sizes: ['M'], _inventoryMode: 'standard' }, 15, 'test').product;
write('products', [product]);
write('orders', []);
write('categories', ['Sinov']);
write('promocodes', []);
write('reviews', []);
write('customers', []);
write('auth-tokens', []);
write('customer-sessions', {});
write('identifier-counters', { nextSku: 2, nextOrderNumber: 1001 });

(async () => {
  const server = createApp({ dataDir, uploadsDir, notifyOrder: async () => {}, emailSender: async () => true }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base + '/');
    await page.locator('#mb-bottom-nav').waitFor();
    assert.deepEqual(await page.locator('#mb-bottom-nav .mb-nav-label').allTextContents(), ['Bosh sahifa', 'Katalog', 'Korzina', 'Profil']);
    const homeNavStyle = await page.locator('#mb-bottom-nav').evaluate(element => ({
      radius: getComputedStyle(element).borderRadius,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      bottom: element.getBoundingClientRect().bottom
    }));
    assert.ok(parseFloat(homeNavStyle.radius) >= 18);
    assert.ok(homeNavStyle.left >= 7 && homeNavStyle.right <= 383 && homeNavStyle.bottom <= 844);
    await page.locator('.product__item').first().waitFor();
    await page.screenshot({ path: path.join(fixture, 'mobile-homepage.png') });

    await page.goto(base + '/product-details.html?id=nav-product');
    await page.locator('.pd-sticky-bar.pd-sticky-bar--visible').waitFor();
    const productBars = await page.evaluate(() => {
      const nav = document.querySelector('#mb-bottom-nav').getBoundingClientRect();
      const sticky = document.querySelector('.pd-sticky-bar').getBoundingClientRect();
      return { navTop: nav.top, stickyBottom: sticky.bottom };
    });
    assert.ok(productBars.stickyBottom <= productBars.navTop, 'Hozir olish paneli pastki navigatsiyani yopmasligi kerak');
    await page.screenshot({ path: path.join(fixture, 'mobile-product-sticky.png') });

    await page.goto(base + '/shop.html');
    await page.locator('#mb-bottom-nav .js-profile-entry').click();
    await page.waitForURL('**/auth.html?return=**');
    assert.ok(decodeURIComponent(new URL(page.url()).searchParams.get('return')).startsWith('/shop.html'));
    await page.locator('#registerTab').click();
    const registration = page.locator('#registerForm');
    await registration.locator('[name=firstName]').fill('Dilnoza');
    await registration.locator('[name=lastName]').fill('Rasulova');
    await registration.locator('[name=phone]').fill('+998901234567');
    await registration.locator('[name=email]').fill('dilnoza@example.uz');
    await registration.locator('[name=password]').fill('StrongPass123');
    await registration.locator('[name=confirmPassword]').fill('StrongPass123');
    await registration.getByRole('button', { name: 'Hisob yaratish' }).click();
    await page.locator('#identifier').fill('+998901234567');
    await page.locator('#loginPassword').fill('StrongPass123');
    await page.locator('#loginForm').getByRole('button', { name: 'Kirish', exact: true }).click();
    await page.waitForURL('**/shop.html');

    await page.locator('#mb-bottom-nav .js-profile-entry').click();
    await page.waitForURL('**/account.html');
    await page.locator('#welcome').filter({ hasText: 'Dilnoza Rasulova' }).waitFor();
    assert.equal(await page.locator('.account-shop-callout').count(), 0);
    assert.equal(await page.locator('.profile-action-list [data-open-section="orders"]').count(), 1);
    assert.equal(await page.locator('.account-nav').evaluate(element => getComputedStyle(element).display), 'none');
    assert.deepEqual(await page.locator('.profile-action-list strong').allTextContents(), ['Buyurtmalarim', 'Manzillarim', 'To‘lovlarim', 'Profil sozlamalari']);
    await page.locator('.profile-secondary-actions').getByText('Yordam', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(fixture, 'mobile-profile.png') });

    await page.goto(base + '/contact.html');
    await page.locator('.contact-card--address').waitFor();
    await page.locator('.contact-map-link').waitFor();
    assert.ok((await page.locator('.contact-address-cta').innerText()).includes('Google Maps'));
    assert.ok((await page.locator('.contact-map-copy').innerText()).includes('Lokatsiya xaritada'));
    await page.locator('.contact-map-box').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(fixture, 'mobile-contact-map-390x844.png') });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const contactBottom = await page.evaluate(() => {
      const nav = document.querySelector('#mb-bottom-nav').getBoundingClientRect();
      const footer = document.querySelector('.sm-footer').getBoundingClientRect();
      return { navTop: nav.top, footerBottom: footer.bottom };
    });
    assert.ok(contactBottom.footerBottom <= contactBottom.navTop, 'Footer pastki navigatsiya ostida qolmasligi kerak');
    await page.screenshot({ path: path.join(fixture, 'mobile-contact-footer-390x844.png') });
    const contactNavLabels = await page.locator('#mb-bottom-nav .mb-nav-label').allTextContents();
    assert.deepEqual(contactNavLabels, ['Bosh sahifa', 'Katalog', 'Korzina', 'Profil']);
    await page.locator('#mb-bottom-nav .js-profile-entry').click();
    await page.waitForURL('**/account.html');

    const orderResponse = await page.evaluate(async () => {
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dilnoza Rasulova', phone: '+998901234567', address: 'Toshkent shahri, sinov manzili', items: [{ productId: 'nav-product', qty: 1, color: 'Qora', size: 'M' }] }) });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(orderResponse.status, 201);
    await page.reload();
    await page.locator('[data-open-section="orders"]').click();
    await page.locator('#ordersList').getByText(orderResponse.body.order.orderNumber).waitFor();
    const orderText = await page.locator('#ordersSection').innerText();
    assert.ok(orderText.includes('Faol') && orderText.includes('Barchasi'));
    assert.ok(!orderText.includes('payment_pending') && !orderText.includes('pending_confirmation'));
    await page.locator('#ordersSection').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(fixture, 'mobile-order-history.png') });

    await page.goto(base + '/shop-cart.html');
    await page.evaluate(productValue => {
      MBStore.saveCart([{ productId: productValue.id, qty: 2, color: 'Qora', size: 'M', product: productValue }]);
    }, product);
    await page.reload();
    await page.locator('#cart-root').getByText('Navigatsiya sinov mahsuloti').waitFor();
    assert.equal(await page.locator('#mb-bottom-nav .mb-nav-badge').textContent(), '2');
    const mobileBars = await page.evaluate(() => {
      const nav = document.querySelector('#mb-bottom-nav').getBoundingClientRect();
      const checkout = document.querySelector('#mb-cart-checkout-bar').getBoundingClientRect();
      return { navTop: nav.top, checkoutBottom: checkout.bottom };
    });
    assert.ok(mobileBars.checkoutBottom <= mobileBars.navTop, 'Korzina tugmasi pastki navigatsiyani yopmasligi kerak');
    await page.screenshot({ path: path.join(fixture, 'mobile-cart.png') });
    assert.equal(await page.locator('.market-action--admin').getAttribute('href'), '/account.html');

    await page.goto(base + '/account.html');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator('#mb-bottom-nav').waitFor();
    const iphoneLayout = await page.evaluate(() => {
      const nav = document.querySelector('#mb-bottom-nav').getBoundingClientRect();
      const panel = document.querySelector('.account-panel').getBoundingClientRect();
      return { navLeft: nav.left, navRight: nav.right, navBottom: nav.bottom, panelLeft: panel.left, panelRight: panel.right };
    });
    assert.ok(iphoneLayout.navLeft >= 7 && iphoneLayout.navRight <= 368 && iphoneLayout.navBottom <= 812);
    assert.ok(iphoneLayout.panelLeft >= 0 && iphoneLayout.panelRight <= 375);
    await page.screenshot({ path: path.join(fixture, 'mobile-profile-375x812.png'), fullPage: true });
    await page.locator('#overviewLogoutBtn').click();
    await page.waitForURL('**/auth.html');
    await page.goto(base + '/shop-cart.html');
    await page.locator('#mb-bottom-nav .js-profile-entry').waitFor();
    const guestProfileHref = await page.locator('#mb-bottom-nav .js-profile-entry').getAttribute('href');
    assert.ok(guestProfileHref.includes('/auth.html?return='));
    assert.ok(!guestProfileHref.includes('admin.html'));

    await page.locator('#mb-bottom-nav .js-profile-entry').click();
    await page.locator('#identifier').fill('navigation-admin');
    await page.locator('#loginPassword').fill('navigation-admin-password');
    await page.locator('#loginForm').getByRole('button', { name: 'Kirish', exact: true }).click();
    await page.waitForURL('**/admin.html');
    await page.locator('#adminApp').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: 19, failed: 0, fixture }));
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
