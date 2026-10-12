(async function () {
  'use strict';
  let csrf = '';
  let customer;
  let orders = [];
  let orderFilter = 'active';
  const labels = window.DodolaOrderLabels;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const money = value => Number(value || 0).toLocaleString('uz-UZ') + ' so‘m';
  const formatDate = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Sana ko‘rsatilmagan' : date.toLocaleString('uz-UZ');
  };
  const message = (text, ok = false) => {
    $('accountMessage').textContent = text;
    $('accountMessage').style.color = ok ? '#15803d' : '#b91c1c';
  };

  async function api(url, options = {}) {
    options.credentials = 'same-origin';
    options.headers = { ...(options.headers || {}), 'X-CSRF-Token': csrf };
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw Error(data.message || 'Xatolik yuz berdi.');
    return data;
  }

  function updateCustomerView() {
    const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ');
    $('welcome').textContent = fullName || 'Mening kabinetim';
    $('accountIdentity').textContent = customer.phone + ' · ' + customer.email;
    $('accountVerification').innerHTML = `<span>Telefon: ${customer.phoneVerified ? 'tasdiqlangan' : 'tasdiqlanmagan'}</span><span>Email: ${customer.emailVerified ? 'tasdiqlangan' : 'tasdiqlanmagan'}</span>`;
    $('resendVerificationBtn').classList.toggle('hidden', customer.emailVerified);
    $('profileForm').firstName.value = customer.firstName;
    $('profileForm').lastName.value = customer.lastName;
    $('profilePhone').value = customer.phone;
    $('profileEmail').value = customer.email;
    $('verificationState').className = customer.emailVerified ? 'status-verified' : 'status-unverified';
    $('verificationState').textContent = customer.emailVerified ? 'Email tasdiqlangan' : 'Email tasdiqlanmagan';
    $('overviewAddressCount').textContent = `${(customer.addresses || []).length} ta saqlangan manzil`;
  }

  async function loadProfile() {
    const response = await fetch('/api/customer/profile', { credentials: 'same-origin' });
    if (response.status === 401) {
      location.href = '/auth.html?return=' + encodeURIComponent('/account.html' + location.hash);
      return false;
    }
    const data = await response.json();
    customer = data.customer;
    csrf = data.csrfToken;
    updateCustomerView();
    renderAddresses();
    return true;
  }

  function isActiveOrder(order) {
    return !['delivered', 'rejected', 'cancelled'].includes(String(order.status || '').toLowerCase());
  }

  function orderCard(order) {
    const items = (order.items || []).map(item => `<div><strong>${esc(item.name || 'Mahsulot')}</strong>${item.sku ? `<span>SKU: ${esc(item.sku)}</span>` : ''}${item.color ? `<span>Rang: ${esc(item.color)}</span>` : ''}${item.size ? `<span>O‘lcham: ${esc(item.size)}</span>` : ''}<span>${Number(item.qty || 0)} ta × ${money(item.price)}</span></div>`).join('');
    return `<article class="account-row order-row"><div class="account-row-header"><div><strong>${esc(order.orderNumber || order.id)}</strong><small> · ${esc(formatDate(order.createdAt))}</small></div><strong>${money(order.total)}</strong></div><div class="order-status-line"><span>Buyurtma: ${esc(labels.status(order.status))}</span><span>To‘lov: ${esc(labels.payment(order.paymentStatus))}</span></div><details><summary>Buyurtma tafsilotlari</summary><div class="order-items">${items || '<div>Mahsulot ma’lumoti mavjud emas.</div>'}</div></details></article>`;
  }

  function renderOrders() {
    const visible = orderFilter === 'active' ? orders.filter(isActiveOrder) : orders;
    $('ordersList').innerHTML = visible.length ? visible.map(orderCard).join('') : `<div class="account-empty"><i class="fa fa-shopping-bag"></i><strong>${orderFilter === 'active' ? 'Faol buyurtma yo‘q' : 'Buyurtmalar hali yo‘q'}</strong><p>${orderFilter === 'active' && orders.length ? 'Barcha buyurtmalar bo‘limida oldingi xaridlaringizni ko‘rishingiz mumkin.' : 'Katalogdan mahsulot tanlab, birinchi buyurtmangizni rasmiylashtiring.'}</p><a href="shop.html">Katalogga o‘tish</a></div>`;
  }

  function renderPayments() {
    $('paymentsList').innerHTML = orders.length ? orders.map(order => `<article class="account-row"><div class="account-row-header"><strong>${esc(order.orderNumber || order.id)}</strong><strong>${money(order.total)}</strong></div><div class="order-status-line"><span>To‘lov: ${esc(labels.payment(order.paymentStatus))}</span><span>Buyurtma: ${esc(labels.status(order.status))}</span></div><small>${esc(formatDate(order.createdAt))}</small></article>`).join('') : '<div class="account-empty"><i class="fa fa-credit-card"></i><strong>To‘lov ma’lumotlari yo‘q</strong><p>Buyurtma rasmiylashtirilgach, uning haqiqiy to‘lov holati shu yerda ko‘rinadi.</p></div>';
  }

  async function loadOrders() {
    const data = await api('/api/customer/orders');
    orders = data.orders || [];
    $('overviewOrderCount').textContent = `${orders.length} ta buyurtma`;
    renderOrders();
    renderPayments();
  }

  function renderAddresses() {
    const rows = customer.addresses || [];
    $('addressesList').innerHTML = rows.length ? rows.map(address => `<article class="account-row"><strong>${esc(address.label)}</strong><p>${esc(address.address)}</p><div class="account-address-actions"><button type="button" class="edit-address" data-edit="${esc(address.id)}">Tahrirlash</button><button type="button" class="delete-address" data-delete="${esc(address.id)}">O‘chirish</button></div></article>`).join('') : '<div class="account-empty"><i class="fa fa-map-marker"></i><strong>Saqlangan manzil yo‘q</strong><p>Tezroq rasmiylashtirish uchun yetkazib berish manzilini saqlang.</p></div>';
    $('overviewAddressCount').textContent = `${rows.length} ta saqlangan manzil`;
    $('addressesList').querySelectorAll('[data-edit]').forEach(button => {
      button.onclick = () => {
        const address = rows.find(item => item.id === button.dataset.edit);
        if (!address) return;
        $('addressForm').elements.id.value = address.id;
        $('addressForm').elements.label.value = address.label;
        $('addressForm').elements.address.value = address.address;
        $('addressForm').elements.label.focus();
      };
    });
    $('addressesList').querySelectorAll('[data-delete]').forEach(button => {
      button.onclick = async () => {
        try {
          const data = await api('/api/customer/addresses/' + encodeURIComponent(button.dataset.delete), { method: 'DELETE' });
          customer.addresses = data.addresses;
          renderAddresses();
          message('Manzil o‘chirildi.', true);
        } catch (error) { message(error.message); }
      };
    });
  }

  const sections = ['overview', 'orders', 'payments', 'addresses', 'settings'];
  function showSection(section, updateHash = true) {
    if (!sections.includes(section)) section = 'overview';
    sections.forEach(name => $(name + 'Section').classList.toggle('hidden', name !== section));
    document.querySelectorAll('[data-section]').forEach(button => button.classList.toggle('active', button.dataset.section === section));
    if (updateHash) history.replaceState(null, '', section === 'overview' ? location.pathname : '#' + section);
    message('');
  }

  document.querySelectorAll('[data-section]').forEach(button => { button.onclick = () => showSection(button.dataset.section); });
  document.querySelectorAll('[data-open-section]').forEach(button => { button.onclick = () => showSection(button.dataset.openSection); });
  document.querySelectorAll('[data-order-filter]').forEach(button => {
    button.onclick = () => {
      orderFilter = button.dataset.orderFilter;
      document.querySelectorAll('[data-order-filter]').forEach(item => item.classList.toggle('active', item === button));
      renderOrders();
    };
  });

  $('resendVerificationBtn').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const data = await api('/api/auth/resend-verification', { method: 'POST' });
      message(data.message, true);
    } catch (error) { message(error.message); }
    finally { button.disabled = false; }
  };

  $('profileForm').onsubmit = async event => {
    event.preventDefault();
    try {
      const data = await api('/api/customer/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      customer = data.customer;
      updateCustomerView();
      message('Ma’lumotlar saqlandi.', true);
    } catch (error) { message(error.message); }
  };
  $('addressForm').onsubmit = async event => {
    event.preventDefault();
    try {
      const data = await api('/api/customer/addresses', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      customer.addresses = data.addresses;
      event.target.reset();
      renderAddresses();
      message('Manzil saqlandi.', true);
    } catch (error) { message(error.message); }
  };
  $('passwordForm').onsubmit = async event => {
    event.preventDefault();
    try {
      const data = await api('/api/customer/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      alert(data.message);
      location.href = '/auth.html';
    } catch (error) { message(error.message); }
  };
  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); }
    finally {
      localStorage.removeItem('mb_admin_token');
      localStorage.removeItem('mb_admin_logged_in');
      location.href = '/auth.html';
    }
  };
  document.querySelectorAll('[data-account-logout]').forEach(button => {
    button.onclick = logout;
  });

  if (await loadProfile()) {
    await loadOrders();
    showSection(location.hash.slice(1), false);
  }
})();
