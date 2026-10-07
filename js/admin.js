(async function () {
  const loginForm = document.getElementById('login-form');
  const productForm = document.getElementById('product-form');
  const loginMessage = document.getElementById('login-message');
  const productMessage = document.getElementById('product-message');
  const adminProducts = document.getElementById('admin-products');
  const adminOrders = document.getElementById('admin-orders');
  const logoutBtn = document.getElementById('logout-btn');
  const resetBtn = document.getElementById('reset-form');

  async function checkAuth() {
    const res = await fetch('/api/admin/me');
    const data = await res.json();
    if (data.authenticated) {
      loginMessage.textContent = 'Admin sifatida kirdingiz';
      logoutBtn.classList.remove('d-none');
      await Promise.all([loadProducts(), loadOrders()]);
    } else {
      loginMessage.textContent = 'Login qiling';
      adminProducts.innerHTML = '<p>Mahsulotlarni ko‘rish uchun login qiling.</p>';
      adminOrders.innerHTML = '<p>Buyurtmalarni ko‘rish uchun login qiling.</p>';
      logoutBtn.classList.add('d-none');
    }
  }

  async function loadProducts() {
    const res = await fetch('/api/products');
    const products = await res.json();
    if (!products.length) {
      adminProducts.innerHTML = '<p>Hali mahsulot yuklanmagan.</p>';
      return;
    }
    adminProducts.innerHTML = products.map(p => `
      <div class="admin-product-item">
        <div class="admin-product-left">
          <img src="${(p.images && p.images[0]) || 'img/placeholders/product.svg'}" alt="">
          <div>
            <strong>${p.name}</strong>
            <p>${p.category}${p.subcategory ? ' / ' + p.subcategory : ''}</p>
            <p>${Number(p.price || 0).toLocaleString('uz-UZ')} so‘m</p>
          </div>
        </div>
        <div class="admin-mini-actions">
          <a href="#" class="link-btn edit-product" data-id="${p.id}">Edit</a>
          <a href="#" class="link-btn delete-product" data-id="${p.id}">Delete</a>
        </div>
      </div>`).join('');

    document.querySelectorAll('.delete-product').forEach(btn => btn.addEventListener('click', async function (e) {
      e.preventDefault();
      if (!confirm('Mahsulot o‘chirilsinmi?')) return;
      const res = await fetch('/api/products/' + this.dataset.id, { method: 'DELETE' });
      if (res.ok) { await loadProducts(); } else { alert('O‘chirishda xatolik'); }
    }));

    document.querySelectorAll('.edit-product').forEach(btn => btn.addEventListener('click', async function (e) {
      e.preventDefault();
      const res = await fetch('/api/products/' + this.dataset.id);
      const p = await res.json();
      productForm.productId.value = p.id;
      productForm.name.value = p.name || '';
      productForm.price.value = p.price || '';
      productForm.oldPrice.value = p.oldPrice || '';
      productForm.stock.value = p.stock || '';
      productForm.category.value = p.category || '';
      productForm.subcategory.value = p.subcategory || '';
      productForm.badge.value = p.badge || '';
      productForm.shipping.value = p.shipping || '';
      productForm.sizes.value = (p.sizes || []).join(',');
      productForm.colors.value = (p.colors || []).join(',');
      productForm.description.value = p.description || '';
      productForm.fullDescription.value = p.fullDescription || '';
      productMessage.textContent = 'Edit holatiga o‘tdi. Yangi rasm yuklasangiz eski rasm almashadi.';
      window.scrollTo({ top: document.getElementById('product-panel').offsetTop - 20, behavior: 'smooth' });
    }));
  }

  async function loadOrders() {
    const res = await fetch('/api/orders');
    if (!res.ok) {
      adminOrders.innerHTML = '<p>Buyurtmalarni ko‘rish uchun login qiling.</p>';
      return;
    }
    const orders = await res.json();
    if (!orders.length) {
      adminOrders.innerHTML = '<p>Hali buyurtma kelmagan.</p>';
      return;
    }
    adminOrders.innerHTML = orders.map(order => `
      <div class="admin-order-item">
        <div class="admin-order-left">
          <div>
            <strong>${order.id}</strong>
            <p>${order.fullName} | ${order.phone}</p>
            <p>${Number(order.total || 0).toLocaleString('uz-UZ')} so‘m</p>
            <p>${(order.items || []).map(x => `${x.name} x ${x.qty}`).join(', ')}</p>
          </div>
        </div>
        <div class="admin-mini-actions">
          <select class="status-select" data-id="${order.id}">
            ${['yangi','tasdiqlandi','yuborildi','yetkazildi','bekor qilindi'].map(st => `<option value="${st}" ${order.status===st?'selected':''}>${st}</option>`).join('')}
          </select>
        </div>
      </div>`).join('');

    document.querySelectorAll('.status-select').forEach(sel => sel.addEventListener('change', async function () {
      await fetch('/api/orders/' + this.dataset.id + '/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: this.value }) });
    }));
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(loginForm).entries());
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    loginMessage.textContent = data.error || 'Muvaffaqiyatli kirdingiz';
    if (res.ok) await checkAuth();
  });

  logoutBtn.addEventListener('click', async function () {
    await fetch('/api/logout', { method: 'POST' });
    await checkAuth();
  });

  resetBtn.addEventListener('click', function () {
    productForm.reset();
    productForm.productId.value = '';
    productMessage.textContent = '';
  });

  productForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const fd = new FormData(productForm);
    const id = fd.get('productId');
    fd.delete('productId');

    // Auto-generate searchable tags using MBSearch if available
    if (window.MBSearch) {
      try {
        const draft = {
          name:        fd.get('name')        || '',
          category:    fd.get('category')    || '',
          brand:       fd.get('brand')       || '',
          colors:      fd.get('colors')      || '',
          sizes:       fd.get('sizes')       || '',
          description: fd.get('description') || '',
        };
        // If admin already entered custom tags, merge them with auto-tags
        const existingTags = (fd.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean);
        draft.tags = existingTags;
        const enriched = MBSearch.autoTagProduct(draft);
        // Remove old tags entry and set merged auto-tags
        fd.delete('tags');
        fd.append('tags', enriched.tags.join(','));
      } catch (err) { /* silent – don't block save */ }
    }

    const url = id ? '/api/products/' + id : '/api/products';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, body: fd });
    const data = await res.json();
    if (res.ok) {
      productMessage.textContent = 'Mahsulot saqlandi';
      productForm.reset();
      productForm.productId.value = '';
      await loadProducts();
    } else {
      productMessage.textContent = data.error || 'Saqlashda xatolik';
    }
  });

  checkAuth();
})();
