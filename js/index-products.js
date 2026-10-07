(function () {
  'use strict';

  const rootNew = document.getElementById('new-products');
  if (!rootNew) return;

  const BATCH_SIZE = 12;

  /* ── State ───────────────────────────────────────────────── */
  let allProducts     = [];
  let filteredProducts = [];
  let currentOffset   = 0;
  let isLoading       = false;
  let allLoaded       = false;
  let observer        = null;
  let sentinel        = null;

  /* ── Skeleton placeholders ───────────────────────────────── */
  function skeletonCards(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html +=
        '<div class="col-6 col-sm-6 col-md-4 col-lg-3">' +
        '<div class="sm-skeleton-card">' +
        '<div class="sm-skeleton sm-skeleton-img"></div>' +
        '<div class="sm-skeleton sm-skeleton-line"></div>' +
        '<div class="sm-skeleton sm-skeleton-line sm-skeleton-line--short"></div>' +
        '</div></div>';
    }
    return html;
  }

  /* ── Spinner keyframe (injected once) ────────────────────── */
  function ensureSpinKeyframe() {
    if (document.getElementById('hp-spin-style')) return;
    const style = document.createElement('style');
    style.id = 'hp-spin-style';
    style.textContent = '@keyframes hp-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  /* ── Loading indicator element ───────────────────────────── */
  function createLoadingIndicator() {
    const el = document.createElement('div');
    el.id = 'hp-loading-indicator';
    el.className = 'col-12';
    el.style.cssText = 'text-align:center;padding:24px 0;display:none;';
    el.innerHTML =
      '<span style="display:inline-flex;align-items:center;gap:8px;color:#888;font-size:14px;">' +
      '<svg width="20" height="20" viewBox="0 0 50 50" style="animation:hp-spin 0.8s linear infinite;" aria-hidden="true">' +
      '<circle cx="25" cy="25" r="20" fill="none" stroke="#ca1515" stroke-width="4" stroke-dasharray="80 20"/>' +
      '</svg>Yuklanmoqda...</span>';
    return el;
  }

  function createSentinel() {
    const el = document.createElement('div');
    el.id = 'hp-scroll-sentinel';
    el.style.cssText = 'height:1px;width:100%;';
    return el;
  }

  function showLoading(show) {
    const el = document.getElementById('hp-loading-indicator');
    if (el) el.style.display = show ? 'block' : 'none';
  }

  /* ── Append a batch of cards ─────────────────────────────── */
  function appendBatch(items) {
    const fragment = document.createDocumentFragment();
    items.forEach(p => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = MBHelpers.productCard(p, { showDescription: false });
      while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild);
    });

    const indicator = document.getElementById('hp-loading-indicator');
    const sentinelEl = document.getElementById('hp-scroll-sentinel');
    const ref = indicator || sentinelEl || null;
    if (ref) ref.parentNode.insertBefore(fragment, ref);
    else rootNew.appendChild(fragment);

    bindQuickAdd(items);
  }

  /* ── Infinite scroll: load next batch ───────────────────── */
  function loadNextBatch() {
    if (isLoading || allLoaded) return;
    const batch = filteredProducts.slice(currentOffset, currentOffset + BATCH_SIZE);
    if (!batch.length) {
      allLoaded = true;
      showLoading(false);
      if (observer && sentinel) observer.unobserve(sentinel);
      return;
    }

    isLoading = true;
    showLoading(true);

    setTimeout(() => {
      appendBatch(batch);
      currentOffset += batch.length;
      if (currentOffset >= filteredProducts.length) {
        allLoaded = true;
        if (observer && sentinel) observer.unobserve(sentinel);
      }
      isLoading = false;
      showLoading(false);
    }, 150);
  }

  /* ── Set up IntersectionObserver ─────────────────────────── */
  function setupObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    sentinel = document.getElementById('hp-scroll-sentinel');
    if (!sentinel) return;

    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !isLoading && !allLoaded) loadNextBatch();
      });
    }, { rootMargin: '200px' });

    observer.observe(sentinel);
  }

  /* ── No-results empty state ──────────────────────────────── */
  function showEmptyState(query) {
    rootNew.innerHTML = '';
    const q = query ? MBSearch.normalizeText(query) : '';
    const msg   = q ? `"${q}" bo'yicha hech qanday mahsulot topilmadi.` : 'Hozircha mahsulot yo\'q.';
    const btnHtml = q
      ? '<button id="hp-clear-search" class="btn btn-primary" style="margin-top:12px;">Qidiruvni tozalash</button>'
      : '';
    rootNew.innerHTML =
      '<div class="col-12"><div class="empty-state" style="text-align:center;padding:40px 20px;">' +
      '<i class="fa fa-search" style="font-size:32px;color:#ccc;margin-bottom:12px;display:block;"></i>' +
      `<h5>Hech qanday mahsulot topilmadi</h5><p>${msg}</p>${btnHtml}` +
      '</div></div>';
    const clearBtn = document.getElementById('hp-clear-search');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const headerInput = document.querySelector('.js-market-search input');
        if (headerInput) headerInput.value = '';
        setFilteredAndRender(allProducts);
      });
    }
  }

  /* ── Primary render: reset scroll state + draw first batch ─ */
  function renderInitial() {
    rootNew.innerHTML = '';

    const loadingEl = createLoadingIndicator();
    const sentinelEl = createSentinel();
    rootNew.appendChild(loadingEl);
    rootNew.appendChild(sentinelEl);

    currentOffset = 0;
    allLoaded     = false;
    isLoading     = false;

    if (!filteredProducts.length) {
      showEmptyState(currentQuery);
      return;
    }

    const firstBatch = filteredProducts.slice(0, BATCH_SIZE);
    appendBatch(firstBatch);
    currentOffset = firstBatch.length;

    if (currentOffset >= filteredProducts.length) {
      allLoaded = true;
    } else {
      setupObserver();
    }
  }

  /* ── Current search query tracker ───────────────────────── */
  let currentQuery = '';

  function setFilteredAndRender(list, query) {
    /* Release any open panel/scroll-lock before rendering */
    if (window.MBPanels) MBPanels.releaseAll();
    currentQuery     = query || '';
    filteredProducts = list;
    renderInitial();
  }

  /* ── Category grid for homepage ──────────────────────────── */
  function renderCategories(list) {
    const grid = document.getElementById('category-grid');
    if (!grid) return;
    const cats = [...new Set(list.map(p => String(p.category || '').trim()).filter(Boolean))];
    if (!cats.length) return;
    const priority = ['Uy jihozlari', 'Oshxona', 'Go‘zallik', 'Ayollar kiyimi', 'Erkaklar kiyimi', 'Ayollar poyabzali', 'Sport', 'Avtomobil'];
    const ordered = priority.filter(cat => cats.includes(cat)).concat(cats.filter(cat => !priority.includes(cat)));
    grid.innerHTML = ordered.slice(0, 8).map(cat => {
      const sample = list.find(p => String(p.category || '') === cat);
      const img = (sample && (sample.image || (sample.images && sample.images[0]))) || 'img/placeholders/product.svg';
      return (
        `<a class="market-category" href="shop.html?category=${encodeURIComponent(cat)}">` +
        `<img src="${img}" alt="${cat}" loading="lazy">` +
        `<h5>${cat}</h5></a>`
      );
    }).join('');
  }

  /* ── Init ────────────────────────────────────────────────── */
  async function init() {
    ensureSpinKeyframe();
    rootNew.innerHTML = skeletonCards(BATCH_SIZE);

    // Ensure engines are loaded
    async function ensureScript(src) {
      if (document.querySelector(`script[src="${src}"]`)) {
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

    try {
      allProducts = await MBHelpers.loadProducts({ forceRefresh: true });
    } catch (e) {
      allProducts = [];
    }

    if (!allProducts.length) {
      rootNew.innerHTML = MBHelpers.emptyState('Admin paneldan birinchi mahsulotni qo\'shing.');
      return;
    }

    // Homepage always starts with the newest catalog additions.
    allProducts.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime() || 0;
      const tb = new Date(b.createdAt || 0).getTime() || 0;
      return tb - ta;
    });

    renderCategories(allProducts);

    // Check if there's a search query in the URL (user came from another page via search)
    const urlParams = new URLSearchParams(window.location.search);
    const urlQuery = (urlParams.get('search') || urlParams.get('q') || '').trim();
    if (urlQuery) {
      const results = MBSearch.searchProducts(allProducts, urlQuery);
      setFilteredAndRender(results, urlQuery);
    } else {
      setFilteredAndRender(allProducts, '');
    }

    // Wire header search form on homepage — filter in-place instead of navigating
    bindHeaderSearch();
  }

  /* ── Header search form wiring (homepage) ────────────────── */
  function bindHeaderSearch() {
    document.querySelectorAll('.js-market-search').forEach(form => {
      // Remove any previous submit listener from shared-header-init.js
      // by replacing the form's submit handler
      form.addEventListener('submit', e => {
        e.preventDefault();
        const input = form.querySelector('input');
        const q = (input && input.value || '').trim();

        if (!q) {
          setFilteredAndRender(allProducts, '');
          return;
        }

        const results = MBSearch.searchProducts(allProducts, q);
        setFilteredAndRender(results, q);

        // Scroll to product section
        const catalogSection = document.getElementById('catalog-section');
        if (catalogSection) {
          setTimeout(() => {
            const top = catalogSection.getBoundingClientRect().top + window.pageYOffset - 16;
            window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          }, 100);
        }
      });

      // Also wire live input on the homepage header search
      const input = form.querySelector('input');
      if (input) {
        let debounceTimer;
        input.addEventListener('input', () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const q = input.value.trim();
            if (!q) {
              setFilteredAndRender(allProducts, '');
              return;
            }
            const results = MBSearch.searchProducts(allProducts, q);
            setFilteredAndRender(results, q);
          }, 350);
        });
      }
    });
  }

  /* ── Cart quick-add ──────────────────────────────────────── */
  function bindQuickAdd(products) {
    rootNew.querySelectorAll('.js-add-card:not([data-bound])').forEach(btn => {
      btn.setAttribute('data-bound', '1');
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
        const self = this;
        setTimeout(() => { self.textContent = orig; }, 1200);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
