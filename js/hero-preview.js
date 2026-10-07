/**
 * Sale Market — Hero Single-Product Carousel
 * Shows ONE product at a time with auto-rotation, dots, and hover-pause.
 */
(function () {
  'use strict';

  var INTERVAL    = 3800;  // ms between slides
  var PLACEHOLDER = 'img/placeholders/product.svg';

  var wrapEl = document.getElementById('hero-preview-wrap');
  var cardEl = document.getElementById('hero-single-card');
  var dotsEl = document.getElementById('hero-preview-dots');

  if (!cardEl) return;

  var products   = [];
  var current    = 0;
  var timer      = null;
  var paused     = false;

  /* ── Helpers ─────────────────────────────────────────── */
  function fmt(n) {
    return Math.round(Number(n) || 0).toLocaleString('uz-UZ') + " so'm";
  }
  function esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function img(p) {
    var src = p.image || (Array.isArray(p.images) && p.images[0]) || '';
    return src || PLACEHOLDER;
  }

  /* ── Render one product into the card slot ─────────────── */
  function render(product, animate) {
    var href   = 'product-details.html?id=' + encodeURIComponent(String(product.id));
    var name   = String(product.name || 'Mahsulot');
    var price  = fmt(product.price);
    var hasOld = product.oldPrice && Number(product.oldPrice) > Number(product.price);
    var cat    = product.category ? '<span class="hsc__badge">' + esc(product.category) + '</span>' : '';

    cardEl.innerHTML =
      '<a class="hsc__link" href="' + esc(href) + '" title="' + esc(name) + '">' +
        '<div class="hsc__img-wrap">' +
          '<img src="' + esc(img(product)) + '" alt="' + esc(name) + '" loading="lazy" ' +
               'onerror="this.src=\'' + PLACEHOLDER + '\'">' +
        '</div>' +
        '<div class="hsc__body">' +
          cat +
          '<div class="hsc__name">' + esc(name) + '</div>' +
          '<div class="hsc__price-row">' +
            '<span class="hsc__price">' + price + '</span>' +
            (hasOld ? '<span class="hsc__old">' + fmt(product.oldPrice) + '</span>' : '') +
          '</div>' +
          '<span class="hsc__cta">Ko\'rish <i class="fa fa-arrow-right"></i></span>' +
        '</div>' +
      '</a>';

    if (animate) {
      cardEl.classList.remove('hsc--in');
      void cardEl.offsetWidth; // reflow
      cardEl.classList.add('hsc--in');
    }
  }

  /* ── Dots ─────────────────────────────────────────────── */
  function buildDots() {
    if (!dotsEl) return;
    var max = Math.min(products.length, 8); // show max 8 dots
    var html = '';
    for (var i = 0; i < max; i++) {
      html += '<button class="hero-dot' + (i === 0 ? ' hero-dot--active' : '') +
              '" data-i="' + i + '" aria-label="Mahsulot ' + (i+1) + '"></button>';
    }
    dotsEl.innerHTML = html;
    dotsEl.querySelectorAll('.hero-dot').forEach(function(btn) {
      btn.addEventListener('click', function() {
        goTo(Number(this.dataset.i));
        resetTimer();
      });
    });
  }

  function updateDots() {
    if (!dotsEl) return;
    dotsEl.querySelectorAll('.hero-dot').forEach(function(btn, i) {
      btn.classList.toggle('hero-dot--active', i === current);
    });
  }

  /* ── Navigation ─────────────────────────────────────────── */
  function goTo(index) {
    current = ((index % products.length) + products.length) % products.length;
    render(products[current], true);
    updateDots();
  }

  function next() { if (!paused) goTo(current + 1); }

  function resetTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(next, INTERVAL);
  }

  /* ── Hover pause ──────────────────────────────────────── */
  if (wrapEl) {
    wrapEl.addEventListener('mouseenter', function() { paused = true; });
    wrapEl.addEventListener('mouseleave', function() { paused = false; });
  }

  /* ── Fallback (no products) ───────────────────────────── */
  function showFallback() {
    cardEl.innerHTML =
      '<a class="hsc__link" href="shop.html">' +
        '<div class="hsc__img-wrap hsc__img-wrap--empty">' +
          '<img src="' + PLACEHOLDER + '" alt="Mahsulotlar">' +
        '</div>' +
        '<div class="hsc__body">' +
          '<div class="hsc__name">Mahsulotlarni ko\'rish</div>' +
          '<span class="hsc__cta">Katalog <i class="fa fa-arrow-right"></i></span>' +
        '</div>' +
      '</a>';
  }

  /* ── Load ────────────────────────────────────────────── */
  async function load() {
    try {
      // Wait for MBHelpers (up to 4s)
      var tries = 40;
      while (!window.MBHelpers && tries-- > 0) {
        await new Promise(function(r){ setTimeout(r, 100); });
      }

      var raw = [];
      if (window.MBHelpers && typeof MBHelpers.loadProducts === 'function') {
        raw = await MBHelpers.loadProducts({ forceRefresh: false });
      } else {
        var res  = await fetch('/api/products', { cache: 'no-store' });
        var data = await res.json();
        raw = Array.isArray(data) ? data : (data.products || data.data || []);
      }

      if (!raw || !raw.length) { showFallback(); return; }

      // Sort: featured first, then newest
      products = raw.slice().sort(function(a, b) {
        var fa = a.featured ? 1 : 0, fb = b.featured ? 1 : 0;
        if (fb !== fa) return fb - fa;
        return (new Date(b.createdAt||0) - new Date(a.createdAt||0));
      });

      render(products[0], true);
      buildDots();
      resetTimer();

    } catch(e) {
      console.warn('[hero-preview]', e.message);
      showFallback();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
