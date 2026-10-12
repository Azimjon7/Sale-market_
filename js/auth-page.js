(async function () {
  'use strict';
  let csrf = '';
  const $ = id => document.getElementById(id);
  const message = (text, ok = false) => {
    $('authMessage').textContent = text;
    $('authMessage').style.color = ok ? '#15803d' : '#b91c1c';
  };

  function safeReturnUrl() {
    const value = new URLSearchParams(location.search).get('return');
    if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/account.html';
    try {
      const parsed = new URL(value, location.origin);
      if (parsed.origin !== location.origin) return '/account.html';
      const blocked = ['/admin.html', '/auth.html', '/reset-password.html'];
      if (blocked.includes(parsed.pathname.toLowerCase())) return '/account.html';
      return parsed.pathname + parsed.search + parsed.hash;
    } catch (_) { return '/account.html'; }
  }

  async function loadSession() {
    const headers = {};
    const adminToken = localStorage.getItem('mb_admin_token');
    if (adminToken) headers.Authorization = 'Bearer ' + adminToken;
    const response = await fetch('/api/auth/session', { headers, credentials: 'same-origin' });
    const data = await response.json();
    csrf = data.csrfToken || '';
    if (data.authenticated) location.replace(data.role === 'admin' ? '/admin.html' : safeReturnUrl());
  }
  await loadSession();

  const show = id => {
    ['loginForm', 'registerForm', 'forgotForm'].forEach(form => $(form).classList.toggle('hidden', form !== id));
    $('loginTab').classList.toggle('active', id === 'loginForm');
    $('registerTab').classList.toggle('active', id === 'registerForm');
    message('');
  };
  $('loginTab').onclick = () => show('loginForm');
  $('registerTab').onclick = () => show('registerForm');
  $('forgotBtn').onclick = () => show('forgotForm');
  $('backLogin').onclick = () => show('loginForm');

  async function post(url, body) {
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw Error(data.message || 'Xatolik yuz berdi.');
    return data;
  }

  $('loginForm').onsubmit = async event => {
    event.preventDefault();
    try {
      const data = await post('/api/auth/login', { identifier: $('identifier').value, password: $('loginPassword').value });
      if (data.role === 'admin') {
        localStorage.setItem('mb_admin_logged_in', 'true');
        localStorage.setItem('mb_admin_token', data.adminToken);
        location.href = '/admin.html';
      } else location.href = safeReturnUrl();
    } catch (error) { message(error.message); }
  };
  $('registerForm').onsubmit = async event => {
    event.preventDefault();
    try {
      const data = await post('/api/auth/register', Object.fromEntries(new FormData(event.target)));
      show('loginForm');
      message(data.message, data.emailDeliveryState === 'accepted');
    } catch (error) { message(error.message); }
  };
  $('forgotForm').onsubmit = async event => {
    event.preventDefault();
    try {
      const data = await post('/api/auth/forgot-password', Object.fromEntries(new FormData(event.target)));
      message(data.message, true);
    } catch (error) { message(error.message); }
  };

  const verificationToken = new URLSearchParams(location.search).get('verify');
  if (verificationToken) {
    try {
      const data = await post('/api/auth/verify-email', { token: verificationToken });
      message(data.message, true);
    } catch (error) { message(error.message); }
  }
})();
