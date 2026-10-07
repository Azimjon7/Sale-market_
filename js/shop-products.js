(async function () {
  'use strict';

  const grid = document.getElementById('shop-grid');
  if (!grid) return;

  /* ── Ensure dependencies ─────────────────────────────────── */
  async function ensureScript(src) {
    if (document.querySelector('script[src="' + src + '"]')) {
      // Already in DOM — wait a tick in case it's still executing
      await new Promise(r => setTimeout(r, 0));
      return;
    }
    return new Promise(r => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = r;
      document.body.appendChild(s);
    });
  }

  if (!window.MBSearch)  await ensureScript('js/search-engine.js');
  if (!window.MBHelpers) await ensureScript('js/helpers.js');

  /* ── State ───────────────────────────────────────────────── */
  let allProducts  = [];
  let reviewCounts = {};

  /* ── Helpers ─────────────────────────────────────────────── */
  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

  function normalizedCategory(value) {
    return MBHelpers.normalizeCategory(value || '');
  }

  /* ── Read search query from ALL possible inputs ──────────── */
  function getSearchQuery() {
    // Priority: visible filter-panel inputs → hidden real input → URL param
    const ids = ['sct-search', 'mcf-search', 'shop-search'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.value.trim()) return el.value.trim();
    }
    const params = new URLSearchParams(window.location.search);
    return (params.get('search') || params.get('q') || '').trim();
  }

  /* Sync a query value into every search input at once */
  function setAllSearchInputs(value) {
    ['sct-search', 'mcf-search', 'shop-search'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });
  }

  /* ── Load ────────────────────────────────────────────────── */
  async function load() {
    allProducts = await MBHelpers.loadProducts({ forceRefresh: true });
    await loadReviewCounts();
    await renderCategoryFilters();
    applyInitialCategoryFromUrl();
    applyInitialSearchFromUrl();
    applyFilter();
  }

  function applyInitialSearchFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get('search') || params.get('q') || '').trim();
    if (q) setAllSearchInputs(q);
  }

  async function loadReviewCounts() {
    try {
      const data = await MBHelpers.fetchJson(MBHelpers.apiUrl('/api/reviews'));
      const list = Array.isArray(data) ? data : [];
      reviewCounts = {};
      list.forEach(r => {
        const id = String(r.productId || r.product_id || '');
        if (id) reviewCounts[id] = (reviewCounts[id] || 0) + 1;
      });
    } catch (e) { reviewCounts = {}; }
  }

  async function renderCategoryFilters() {
    const wrap = document.querySelector('.shop-toolbar__filters');
    if (!wrap) return;
    const categoryCounts = allProducts.reduce((acc, product) => {
      const cat = String(product.category || '').trim();
      if (cat) acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {});
    const categories = [...new Set(allProducts.map(p => p.category).filter(Boolean))]
      .sort((a, b) => (categoryCounts[b] || 0) - (categoryCounts[a] || 0) || String(a).localeCompare(String(b), 'uz'));
    const buttons = [`<button class="filter-btn active" data-category="" data-count="${allProducts.length}">Barchasi</button>`].concat(
      categories.map(cat => `<button class="filter-btn" data-category="${cat}" data-count="${categoryCounts[cat] || 0}">${cat}</button>`)
    );
    wrap.innerHTML = buttons.join('');
    bindFilterButtons();
  }

  /* ── Render ──────────────────────────────────────────────── */
  function render(items) {
    // Update counts
    const countEl = document.getElementById('shop-count');
    if (countEl) {
      const q = getSearchQuery();
      countEl.textContent = q
        ? `"${q}" bo'yicha ${items.length} ta mahsulot`
        : `${items.length} ta / ${allProducts.length} ta mahsulot ko'rsatilmoqda`;
    }

    if (!items.length) {
      const q = MBSearch.normalizeText(getSearchQuery());
      const emptyTitle = q ? 'Hech qanday mahsulot topilmadi' : 'Mahsulot topilmadi';
      const emptyDesc  = q
        ? `"${q}" so'rovi bo'yicha hech narsa topilmadi.`
        : "Filtrlarni o'zgartiring yoki tozalang.";
      const clearLabel = q ? 'Qidiruvni tozalash' : 'Filtrlarni tozalash';
      grid.innerHTML =
        `<div class="shop-empty">` +
        `<div class="shop-empty__icon"><i class="fa fa-search"></i></div>` +
        `<h3>${emptyTitle}</h3>` +
        `<p>${emptyDesc}</p>` +
        `<button type="button" class="btn btn-primary" id="shop-empty-clear">${clearLabel}</button>` +
        `</div>`;
      const btn = document.getElementById('shop-empty-clear');
      if (btn) btn.addEventListener('click', clearFilters);
      return;
    }

    grid.innerHTML = items.map(p => MBHelpers.productCard(p, { showDescription: false })).join('');

    grid.querySelectorAll('.js-add-card').forEach(btn =>
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        const p = allProducts.find(x => String(x.id) === String(this.dataset.id));
        if (!p) return;
        MBStore.addToCart({
          productId: p.id, qty: 1,
          size:  (p.sizes  && p.sizes[0])  || '',
          color: (p.colors && p.colors[0]) || '',
          product: p,
        });
        if (MBStore.updateCartCounters) MBStore.updateCartCounters();
        document.dispatchEvent(new CustomEvent('mb:cart-updated'));
        const orig = this.textContent;
        this.textContent = "Qo'shildi ✓";
        setTimeout(() => { this.textContent = orig; }, 1200);
      })
    );
  }

  /* ── Core filter + search ────────────────────────────────── */
  function applyFilter() {
    /* Always release any open panel/scroll-lock before rendering results */
    if (window.MBPanels) MBPanels.releaseAll();

    const active = document.querySelector('.filter-btn.active');
    const selectedCategory = active ? normalizedCategory(active.dataset.category) : '';
    const q = getSearchQuery();

    const minEl = document.getElementById('shop-price-min');
    const maxEl = document.getElementById('shop-price-max');
    const min = minEl && minEl.value !== '' ? Number(minEl.value) : null;
    const max = maxEl && maxEl.value !== '' ? Number(maxEl.value) : null;

    // Step 1: text search (MBSearch handles normalisation + alias expansion)
    let filtered = MBSearch.searchProducts(allProducts, q);

    // Step 2: category filter
    if (selectedCategory) {
      filtered = filtered.filter(p => normalizedCategory(p.category) === selectedCategory);
    }

    // Step 3: price filter
    if (min !== null || max !== null) {
      filtered = filtered.filter(p => {
        const price = Number(p.price || 0);
        return (min === null || price >= min) && (max === null || price <= max);
      });
    }

    // Step 4: sort
    const sortEl = document.getElementById('shop-sort');
    const sort = (sortEl && sortEl.value) || 'newest';
    if (sort === 'price_asc') {
      filtered.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    } else if (sort === 'price_desc') {
      filtered.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    } else if (sort === 'most_reviewed') {
      filtered.sort((a, b) => (reviewCounts[String(b.id)] || 0) - (reviewCounts[String(a.id)] || 0));
    } else {
      filtered.sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime() || 0;
        const tb = new Date(b.createdAt || 0).getTime() || 0;
        return tb - ta;
      });
    }

    render(filtered);
  }

  /* ── Clear ───────────────────────────────────────────────── */
  function clearFilters() {
    setAllSearchInputs('');
    const minEl = document.getElementById('shop-price-min');
    const maxEl = document.getElementById('shop-price-max');
    if (minEl) minEl.value = '';
    if (maxEl) maxEl.value = '';
    const sortEl = document.getElementById('shop-sort');
    if (sortEl) sortEl.value = 'newest';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const allBtn = document.querySelector('.filter-btn[data-category=""]');
    if (allBtn) allBtn.classList.add('active');
    applyFilter();
  }

  function applyInitialCategoryFromUrl() {
    const urlCategory = new URLSearchParams(window.location.search).get('category');
    if (!urlCategory) return;
    const normalized = normalizedCategory(urlCategory);
    const buttons = Array.from(document.querySelectorAll('.filter-btn'));
    const target = buttons.find(b => normalizedCategory(b.dataset.category) === normalized);
    if (!target) return;
    buttons.forEach(b => b.classList.remove('active'));
    target.classList.add('active');
  }

  function bindFilterButtons() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        applyFilter();
      });
    });
  }

  /* ── Event wiring ────────────────────────────────────────── */

  // Hidden real input (toolbar bridge writes here and fires 'input')
  const hiddenSearch = document.getElementById('shop-search');
  if (hiddenSearch) hiddenSearch.addEventListener('input', debounce(applyFilter, 300));

  // Visible inputs: live typing triggers filter immediately
  ['sct-search', 'mcf-search'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', debounce(applyFilter, 300));
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); applyFilter(); }
    });
  });

  // Header search form on the shop page — intercept submit, filter in-place
  document.querySelectorAll('.js-market-search').forEach(form => {
    form.addEventListener('submit', e => {
      if (!document.getElementById('shop-grid')) return;
      e.preventDefault();
      const input = form.querySelector('input');
      const q = (input && input.value || '').trim();
      setAllSearchInputs(q);
      applyFilter();
    });
  });

  const sortEl = document.getElementById('shop-sort');
  if (sortEl) sortEl.addEventListener('change', applyFilter);

  const minEl = document.getElementById('shop-price-min');
  if (minEl) minEl.addEventListener('input', debounce(applyFilter, 300));

  const maxEl = document.getElementById('shop-price-max');
  if (maxEl) maxEl.addEventListener('input', debounce(applyFilter, 300));

  const clearBtn = document.getElementById('shop-clear-filters');
  if (clearBtn) clearBtn.addEventListener('click', clearFilters);

  load();
})();
