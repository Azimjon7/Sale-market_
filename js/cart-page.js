(async function () {
  const root = document.getElementById('cart-root');
  if (!root) return;

  // ── ensure helpers loaded ─────────────────────────────────────────────────
  if (!window.MBHelpers) {
    const s = document.createElement('script');
    s.src = 'js/helpers.js';
    document.body.appendChild(s);
    await new Promise((r) => (s.onload = r));
  }

  // ── state ─────────────────────────────────────────────────────────────────
  let cartItems = [];   // { ...cartEntry, index, product }
  let allProducts = [];
  let appliedPromo = null; // { code, discountAmount, total }

  // ── helpers ───────────────────────────────────────────────────────────────
  function formatMoney(val) {
    return Number(val || 0).toLocaleString('uz-UZ') + " so'm";
  }

  function calcTotals() {
    const subtotal = cartItems.reduce(
      (s, item) => s + (Number(item.product.price) || 0) * item.qty, 0
    );
    const discount = appliedPromo ? Math.min(appliedPromo.discountAmount || 0, subtotal) : 0;
    const afterDiscount = Math.max(0, subtotal - discount);
    const delivery = afterDiscount > 300000 ? 0 : 25000;
    return { subtotal, discount, delivery, grandTotal: afterDiscount + delivery };
  }

  function isMobile() {
    return window.innerWidth <= 768;
  }

  // ── sticky checkout bar ───────────────────────────────────────────────────
  function injectCheckoutBar() {
    if (document.getElementById('mb-cart-checkout-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'mb-cart-checkout-bar';
    bar.innerHTML =
      '<div class="mb-bar-total">' +
        '<span class="mb-bar-total-label">Umumiy summa</span>' +
        '<span class="mb-bar-total-amount" id="mb-bar-amount">0 so\'m</span>' +
      '</div>' +
      '<a href="checkout.html" class="mb-bar-btn">' +
        '<i class="fa fa-credit-card"></i> Buyurtma berish' +
      '</a>';
    document.body.appendChild(bar);
  }

  function updateCheckoutBar() {
    const bar = document.getElementById('mb-cart-checkout-bar');
    if (!bar) return;
    if (!cartItems.length) {
      bar.classList.add('mb-bar--hidden');
      return;
    }
    bar.classList.remove('mb-bar--hidden');
    const amountEl = document.getElementById('mb-bar-amount');
    if (amountEl) amountEl.textContent = formatMoney(calcTotals().grandTotal);
  }

  // ── cart count badge ──────────────────────────────────────────────────────
  function refreshCartBadge() {
    const count = cartItems.reduce((s, i) => s + i.qty, 0);
    document.querySelectorAll('.js-cart-count, .market-cart-tip').forEach(el => {
      el.textContent = count;
    });
    const navBadge = document.querySelector('#mb-bottom-nav .mb-nav-badge');
    if (navBadge) {
      if (count > 0) navBadge.textContent = count > 99 ? '99+' : count;
      else navBadge.remove();
    }
    document.dispatchEvent(new CustomEvent('mb:cart-updated'));
  }

  // ── render summary sidebar ────────────────────────────────────────────────
  function renderSummary() {
    const { subtotal, discount, delivery, grandTotal } = calcTotals();
    const summaryEl = document.getElementById('cart-summary-aside');
    if (!summaryEl) return;
    summaryEl.innerHTML =
      '<div class="summary-badge"><i class="fa fa-shield"></i> Xavfsiz buyurtma</div>' +
      '<h3>Buyurtma xulosasi</h3>' +
      '<div class="summary-line"><span>Mahsulotlar</span><strong>' + formatMoney(subtotal) + '</strong></div>' +
      (discount > 0 ? '<div class="summary-line"><span>Chegirma' + (appliedPromo ? ' (' + appliedPromo.code + ')' : '') + '</span><strong>-' + formatMoney(discount) + '</strong></div>' : '') +
      '<div class="summary-line"><span>Yetkazib berish</span><strong>' + (delivery ? formatMoney(delivery) : 'Bepul') + '</strong></div>' +
      '<div class="cart-promo">' +
        '<label class="form-label" for="cart-promo-input">Promokod</label>' +
        '<div class="cart-promo-row">' +
          '<input type="text" id="cart-promo-input" class="form-input" placeholder="Masalan: SALE10">' +
          '<button type="button" id="cart-promo-apply" class="btn btn-outline btn-sm">Qo\'llash</button>' +
        '</div>' +
        '<div id="cart-promo-msg" class="form-hint"></div>' +
      '</div>' +
      '<div class="summary-divider"></div>' +
      '<div class="summary-total"><span>Umumiy summa</span><strong>' + formatMoney(grandTotal) + '</strong></div>' +
      '<a href="checkout.html" class="market-btn market-btn--full"><i class="fa fa-credit-card"></i> Buyurtmaga o\'tish</a>' +
      '<p class="summary-note">300 000 so\'mdan yuqori xaridlar uchun yetkazish bepul.</p>';
    bindPromoEvents();
  }

  // ── promo code events & apply logic ───────────────────────────────────────
  function bindPromoEvents() {
    const applyBtn = document.getElementById('cart-promo-apply');
    const input = document.getElementById('cart-promo-input');
    if (input && appliedPromo) input.value = appliedPromo.code;
    if (applyBtn) applyBtn.addEventListener('click', applyPromo);
  }

  async function applyPromo() {
    const input = document.getElementById('cart-promo-input');
    const msg = document.getElementById('cart-promo-msg');
    const code = (input && input.value || '').trim();
    if (!code) { if (msg) { msg.textContent = 'Promokod kiriting.'; msg.style.color = 'var(--color-danger)'; } return; }
    const { subtotal } = calcTotals();
    try {
      const res = await fetch('/api/promocodes/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, subtotal }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Promokod ishlamadi');
      const discountAmount = Number(data.discountAmount != null ? data.discountAmount : (subtotal - (data.total != null ? data.total : subtotal)));
      appliedPromo = { code: (data.code || code).toUpperCase(), discountAmount: Math.max(0, discountAmount) };
      if (msg) { msg.textContent = "Promokod qo'llandi."; msg.style.color = 'var(--color-success)'; }
      renderSummary();
      updateCheckoutBar();
    } catch (err) {
      appliedPromo = null;
      if (msg) { msg.textContent = err.message || 'Promokod ishlamadi'; msg.style.color = 'var(--color-danger)'; }
      renderSummary();
      updateCheckoutBar();
    }
  }

  // ── render a single cart card ─────────────────────────────────────────────
  function renderCard(item) {
    const img = item.product.image
      || (item.product.images && item.product.images[0])
      || 'img/placeholders/product.svg';
    const price = Number(item.product.price || 0);
    const lineTotal = price * item.qty;
    return (
      '<div class="market-cart-card" data-cart-index="' + item.index + '">' +
        '<div class="market-cart-img">' +
          '<img src="' + img + '" alt="' + (item.product.name || '') + '" loading="lazy">' +
        '</div>' +
        '<div class="market-cart-info">' +
          '<div class="market-cart-title-row">' +
            '<div>' +
              '<h4>' + (item.product.name || 'Mahsulot') + '</h4>' +
              '<p>' + (item.size || "O'lcham tanlanmagan") + ' / ' + (item.color || 'Rang tanlanmagan') + '</p>' +
            '</div>' +
          '</div>' +
          '<div class="market-cart-price">' +
            '<strong>' + formatMoney(price) + '</strong>' +
            '<span id="cart-line-total-' + item.index + '">Jami: ' + formatMoney(lineTotal) + '</span>' +
          '</div>' +
          '<div class="market-cart-controls">' +
            '<button type="button" class="cart-qty-btn" data-index="' + item.index + '" data-delta="-1" aria-label="Kamaytirish">-</button>' +
            '<input type="number" min="1" value="' + item.qty + '" data-index="' + item.index + '" class="cart-qty-input" aria-label="Miqdor">' +
            '<button type="button" class="cart-qty-btn" data-index="' + item.index + '" data-delta="1" aria-label="Ko\'paytirish">+</button>' +
            '<a href="#" class="market-remove cart-remove" data-index="' + item.index + '" aria-label="O\'chirish">' +
              '<i class="fa fa-trash"></i> O\'chirish' +
            '</a>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // ── render full cart list ─────────────────────────────────────────────────
  function renderCartList() {
    const listEl = document.getElementById('cart-items-list');
    if (!listEl) return;
    if (!cartItems.length) {
      // show empty state, replace entire root
      root.innerHTML =
        '<div class="market-empty-state">' +
          '<div class="market-empty-icon"><i class="fa fa-shopping-bag"></i></div>' +
          '<h3>Savat bo\'sh</h3>' +
          '<p>Yoqtirgan mahsulotingizni katalogdan tanlang va savatga qo\'shing.</p>' +
          '<a href="shop.html" class="market-btn"><i class="fa fa-th-large"></i> Katalogga o\'tish</a>' +
        '</div>';
      // hide sticky bar
      const bar = document.getElementById('mb-cart-checkout-bar');
      if (bar) bar.classList.add('mb-bar--hidden');
      return;
    }
    listEl.innerHTML = cartItems.map(renderCard).join('');
    bindCardEvents();
  }

  // ── update one card's qty display without full re-render ──────────────────
  function updateCardQty(index, newQty) {
    const card = document.querySelector('.market-cart-card[data-cart-index="' + index + '"]');
    if (!card) return;
    const input = card.querySelector('.cart-qty-input');
    if (input) input.value = newQty;
    const item = cartItems.find(i => i.index === index);
    if (!item) return;
    item.qty = newQty;
    const price = Number(item.product.price || 0);
    const lineTotalEl = document.getElementById('cart-line-total-' + index);
    if (lineTotalEl) lineTotalEl.textContent = 'Jami: ' + formatMoney(price * newQty);
  }

  // ── bind events on rendered cards ────────────────────────────────────────
  function bindCardEvents() {
    // qty buttons
    document.querySelectorAll('.cart-qty-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const index = Number(this.dataset.index);
        const delta = Number(this.dataset.delta);
        const item = cartItems.find(i => i.index === index);
        if (!item) return;
        const newQty = Math.max(1, item.qty + delta);
        MBStore.updateQty(index, newQty);
        updateCardQty(index, newQty);
        renderSummary();
        updateCheckoutBar();
        refreshCartBadge();
        // update item count label
        const countEl = document.querySelector('.market-cart-head p');
        if (countEl) countEl.textContent = cartItems.length + ' xil mahsulot tanlandi';
      });
    });

    // qty input
    document.querySelectorAll('.cart-qty-input').forEach(input => {
      input.addEventListener('change', function () {
        const index = Number(this.dataset.index);
        const newQty = Math.max(1, Number(this.value) || 1);
        MBStore.updateQty(index, newQty);
        updateCardQty(index, newQty);
        renderSummary();
        updateCheckoutBar();
        refreshCartBadge();
      });
    });

    // remove buttons
    document.querySelectorAll('.cart-remove').forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        const index = Number(this.dataset.index);
        MBStore.removeFromCart(index);
        // re-build cartItems from store (indices shift after removal)
        const rawCart = MBStore.getCart();
        cartItems = rawCart.map((entry, i) => ({
          ...entry,
          index: i,
          product: allProducts.find(p => String(p.id) === String(entry.productId)) || entry.product || {},
        }));
        renderCartList();
        renderSummary();
        updateCheckoutBar();
        refreshCartBadge();
      });
    });
  }

  // ── initial render ────────────────────────────────────────────────────────
  const rawCart = MBStore.getCart();

  if (!rawCart.length) {
    root.innerHTML =
      '<div class="market-empty-state">' +
        '<div class="market-empty-icon"><i class="fa fa-shopping-bag"></i></div>' +
        '<h3>Savat bo\'sh</h3>' +
        '<p>Yoqtirgan mahsulotingizni katalogdan tanlang va savatga qo\'shing.</p>' +
        '<a href="shop.html" class="market-btn"><i class="fa fa-th-large"></i> Katalogga o\'tish</a>' +
      '</div>';
    // inject hidden bar anyway (CSS handles hiding)
    if (isMobile()) injectCheckoutBar();
    return;
  }

  allProducts = await MBHelpers.loadProducts({ forceRefresh: true });
  cartItems = rawCart.map((entry, i) => ({
    ...entry,
    index: i,
    product: allProducts.find(p => String(p.id) === String(entry.productId)) || entry.product || {},
  }));

  const { subtotal, delivery, grandTotal } = calcTotals();

  root.innerHTML =
    '<div class="market-cart-layout">' +
      '<div class="market-cart-list">' +
        '<div class="market-cart-head">' +
          '<div>' +
            '<h3>Savatdagi mahsulotlar</h3>' +
            '<p>' + cartItems.length + ' xil mahsulot tanlandi</p>' +
          '</div>' +
          '<a href="shop.html" class="market-mini-link"><i class="fa fa-plus"></i> Yana qo\'shish</a>' +
        '</div>' +
        '<div id="cart-items-list">' +
          cartItems.map(renderCard).join('') +
        '</div>' +
      '</div>' +
      '<aside class="market-order-summary" id="cart-summary-aside">' +
        '<div class="summary-badge"><i class="fa fa-shield"></i> Xavfsiz buyurtma</div>' +
        '<h3>Buyurtma xulosasi</h3>' +
        '<div class="summary-line"><span>Mahsulotlar</span><strong>' + formatMoney(subtotal) + '</strong></div>' +
        '<div class="summary-line"><span>Yetkazib berish</span><strong>' + (delivery ? formatMoney(delivery) : 'Bepul') + '</strong></div>' +
        '<div class="summary-divider"></div>' +
        '<div class="summary-total"><span>Umumiy summa</span><strong>' + formatMoney(grandTotal) + '</strong></div>' +
        '<a href="checkout.html" class="market-btn market-btn--full"><i class="fa fa-credit-card"></i> Buyurtmaga o\'tish</a>' +
        '<p class="summary-note">300 000 so\'mdan yuqori xaridlar uchun yetkazish bepul.</p>' +
      '</aside>' +
    '</div>';

  bindCardEvents();
  renderSummary();

  // inject sticky bar on mobile
  if (isMobile()) {
    injectCheckoutBar();
    updateCheckoutBar();
  }

  // update bar on resize (e.g. orientation change)
  window.addEventListener('resize', function () {
    if (isMobile()) {
      injectCheckoutBar();
      updateCheckoutBar();
    }
  });
})();
