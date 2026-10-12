(async function () {
  const summary = document.getElementById('checkout-summary');
  const form = document.getElementById('checkout-form');
  const msg = document.getElementById('checkout-message');
  if (!summary || !form) return;
  if (!window.MBHelpers) {
    const s = document.createElement("script");
    s.src = "js/helpers.js";
    document.body.appendChild(s);
    await new Promise((r) => (s.onload = r));
  }

  // Helper to validate stock before checkout
  async function validateProductStock(product, qty) {
    if (!product) {
      return { valid: false, error: 'Product not found' };
    }
    if (!qty || qty <= 0) {
      return { valid: false, error: 'Quantity must be greater than 0' };
    }
    const inventoryMode = product._inventoryMode || 'standard';
    // Made-to-order products: no stock validation
    if (inventoryMode === 'made-to-order') {
      if (qty > 100) {
        return { valid: true, warning: 'High quantity for made-to-order item' };
      }
      return { valid: true };
    }
    // Standard inventory mode: strict stock validation
    if (inventoryMode === 'standard' || !inventoryMode) {
      const stock = product.stock === undefined || product.stock === null || product.stock === ''
        ? 999
        : Math.max(0, Math.floor(Number(product.stock) || 0));
      if (qty > stock) {
        return {
          valid: false,
          error: `Insufficient stock. Available: ${stock}, Requested: ${qty}`
        };
      }
      return { valid: true };
    }
    return { valid: false, error: 'Unknown inventory mode' };
  }

  // Helper to get inventory badge
  function getInventoryBadge(product) {
    const mode = product._inventoryMode || 'standard';
    if (mode === 'made-to-order') {
      const days = product._productionDays || 14;
      return `<span class="inventory-badge mto">Buyurtma asosida (~${days} kun)</span>`;
    }
    const stock = Number(product.stock || 0);
    if (stock === 0) {
      return '<span class="inventory-badge out-of-stock">Stokda yo\'q</span>';
    }
    return '<span class="inventory-badge in-stock">Stokda bor</span>';
  }

  if (!window.MBOrderSubmit) {
    const script = document.createElement('script');
    script.src = 'js/order-submit.js';
    await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.body.appendChild(script); });
  }
  const cart = MBStore.getCart();
  if (!cart.length) {
    summary.innerHTML = '<p>Korzina bo\'sh.</p><a href="shop.html" class="site-btn">Mahsulot tanlash</a>';
    form.style.display = 'none';
    return;
  }
  
  const products = await MBHelpers.loadProducts({ forceRefresh: true });
  const items = cart.map(item => ({ ...item, product: products.find(p => p.id === item.productId) || {} }));
  const total = items.reduce((sum, item) => sum + (Number(item.product.price) || 0) * item.qty, 0);
  
  // Check if any item is made-to-order
  const hasMTO = items.some(item => (item.product._inventoryMode || 'standard') === 'made-to-order');
  
  summary.innerHTML = (hasMTO ? '<div class="payment-notice"><i class="fa fa-info-circle"></i> Buyurtma admin tasdiqlangunga qadar to\'lov olinmaydi.</div>' : '') +
    items.map(item => `
      <div class="order-summary-item">
        <div>
          <strong>${item.product.name || 'Mahsulot'}</strong>
          <p>${item.size || '-'} / ${item.color || '-'} x ${item.qty}</p>
          ${getInventoryBadge(item.product)}
        </div>
        <span>${((Number(item.product.price) || 0) * item.qty).toLocaleString('uz-UZ')} so\'m</span>
      </div>
    `).join('') + `<div class="total-line"><span>Jami</span><span>${total.toLocaleString('uz-UZ')} so\'m</span></div>`;
  
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    
    // Validate stock for all items before submission
    for (let item of items) {
      const validation = await validateProductStock(item.product, item.qty);
      if (!validation.valid) {
        msg.textContent = `❌ ${item.product.name}: ${validation.error}`;
        msg.style.color = '#721c24';
        return;
      }
    }
    
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.items = items.map(item => ({ 
      productId: item.productId, 
      name: item.product.name, 
      size: item.size, 
      color: item.color, 
      qty: item.qty, 
      price: item.product.price,
      inventoryMode: item.product._inventoryMode || 'standard'
    }));
    payload.total = total;
    payload.subtotal = total;
    payload.discountAmount = 0;
    
    const button = form.querySelector('[type="submit"]');
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    if (button) button.disabled = true;
    payload.submissionToken = MBOrderSubmit.submissionToken(payload);
    try {
      const order = await MBOrderSubmit.submitOrder({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      MBOrderSubmit.forgetSubmissionToken();
      MBStore.clearCart();
      msg.textContent = 'Buyurtma yuborildi. Raqam: ' + (order.orderNumber || order.id);
      msg.style.color = '#155724';
      form.reset();
      summary.innerHTML = '<p>Buyurtma muvaffaqiyatli yuborildi.</p>';
      let successUrl = 'success.html?orderNumber=' + encodeURIComponent(order.orderNumber || '');
      if (order.trackingToken) successUrl += '&trackingToken=' + encodeURIComponent(order.trackingToken);
      window.location.href = successUrl;
    } catch (error) {
      msg.textContent = error.message;
      msg.style.color = '#721c24';
    } finally {
      form.dataset.submitting = 'false';
      if (button) button.disabled = false;
    }
  });
})();

