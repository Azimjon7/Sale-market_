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
  const cart = MBStore.getCart();
  if (!cart.length) {
    summary.innerHTML = '<p>Savat bo‘sh.</p><a href="shop.html" class="site-btn">Mahsulot tanlash</a>';
    form.style.display = 'none';
    return;
  }
  const products = await MBHelpers.loadProducts({ forceRefresh: true });
  const items = cart.map(item => ({ ...item, product: products.find(p => p.id === item.productId) || {} }));
  const total = items.reduce((sum, item) => sum + (Number(item.product.price) || 0) * item.qty, 0);
  summary.innerHTML = items.map(item => `
    <div class="order-summary-item"><div><strong>${item.product.name || 'Mahsulot'}</strong><p>${item.size || '-'} / ${item.color || '-'} x ${item.qty}</p></div><span>${((Number(item.product.price) || 0) * item.qty).toLocaleString('uz-UZ')} so‘m</span></div>
  `).join('') + `<div class="total-line"><span>Jami</span><span>${total.toLocaleString('uz-UZ')} so‘m</span></div>`;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.items = items.map(item => ({ productId: item.productId, name: item.product.name, size: item.size, color: item.color, qty: item.qty, price: item.product.price }));
    payload.total = total;
    const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (res.ok) {
      MBStore.clearCart();
      msg.textContent = 'Buyurtma yuborildi. ID: ' + data.orderId;
      form.reset();
      summary.innerHTML = '<p>Buyurtma muvaffaqiyatli yuborildi.</p>';
    } else {
      msg.textContent = data.error || 'Xatolik yuz berdi';
    }
  });
})();
