/**
 * Sale Market — Mobile Catalog Filter UI v2
 *
 * Responsibilities:
 *   1. Wire Sort bottom sheet (Saralash button)
 *   2. Wire Filter bottom sheet (Filtr / Narx buttons)
 *   3. Wire Catalog full-height overlay (yellow header catalog button)
 *      – populates category rows from real .shop-toolbar__filters buttons
 *      – category tap → close overlay, apply filter, scroll to grid
 *   4. Mirror #shop-count → #mcf-count-text
 *   5. Show/hide filter badge on Filtr button
 *   6. View toggle (cosmetic)
 *
 * Strategy:
 *   - NEVER touches real inputs/selects directly except to write values
 *     and fire events — shop-products.js owns all filter logic.
 *   - No duplicate filter logic created.
 *
 * Runs only when window.innerWidth ≤ 768 at script load time.
 */

(function () {
  'use strict';

  if (window.innerWidth > 768) return;

  /* ── Helpers ──────────────────────────────────────────── */

  function fireInput(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function fireChange(el) {
    if (!el) return;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function raf(fn) { requestAnimationFrame(fn); }

  /* ── Real hidden inputs (owned by shop-products.js) ───── */

  var realSearch = document.getElementById('shop-search');
  var realSort   = document.getElementById('shop-sort');
  var realMin    = document.getElementById('shop-price-min');
  var realMax    = document.getElementById('shop-price-max');
  var realClear  = document.getElementById('shop-clear-filters');

  /* ── Mobile count mirror ──────────────────────────────── */

  var mcfCountText = document.getElementById('mcf-count-text');
  var realCountEl  = document.getElementById('shop-count');

  if (realCountEl && mcfCountText) {
    var countObserver = new MutationObserver(function () {
      mcfCountText.textContent = realCountEl.textContent;
    });
    countObserver.observe(realCountEl, { childList: true, characterData: true, subtree: true });
    mcfCountText.textContent = realCountEl.textContent;
  }

  /* ── Sort sheet ───────────────────────────────────────── */

  var sortBtn      = document.getElementById('mcf-sort-btn');
  var sortOverlay  = document.getElementById('mcf-sort-overlay');
  var sortSheet    = document.getElementById('mcf-sort-sheet');
  var sortClose    = document.getElementById('mcf-sort-close');
  var sortOpts     = document.querySelectorAll('.mcf-sort-opt');

  var sortLabels = {
    newest:        'Saralash',
    price_asc:     'Narx ↑',
    price_desc:    'Narx ↓',
    most_reviewed: 'Mashhur',
  };

  function setActiveSortOpt(value) {
    sortOpts.forEach(function (opt) {
      opt.classList.toggle('mcf-sort-opt--active', opt.dataset.value === value);
    });
    var labelEl = sortBtn && sortBtn.querySelector('.mcf-btn-label');
    if (labelEl) labelEl.textContent = sortLabels[value] || 'Saralash';
    var isCustomSort = value && value !== 'newest';
    if (sortBtn) sortBtn.classList.toggle('mcf-btn--active', isCustomSort);
  }

  function openSortSheet() {
    if (!sortOverlay || !sortSheet) return;
    sortOverlay.style.display = 'block';
    raf(function () {
      sortOverlay.classList.add('mcf-sort-overlay--open');
      sortSheet.classList.add('mcf-sort-sheet--open');
    });
    if (window.MBPanels) MBPanels.lockScroll();
    else document.body.style.overflow = 'hidden';
  }

  function closeSortSheet() {
    if (!sortOverlay || !sortSheet) return;
    sortOverlay.classList.remove('mcf-sort-overlay--open');
    sortSheet.classList.remove('mcf-sort-sheet--open');
    if (window.MBPanels) MBPanels.unlockScroll();
    else document.body.style.overflow = '';
    setTimeout(function () { sortOverlay.style.display = 'none'; }, 280);
  }

  if (window.MBPanels) MBPanels.register('mcfSort', closeSortSheet);

  if (sortBtn)     sortBtn.addEventListener('click', openSortSheet);
  if (sortClose)   sortClose.addEventListener('click', closeSortSheet);
  if (sortOverlay) sortOverlay.addEventListener('click', closeSortSheet);

  sortOpts.forEach(function (opt) {
    opt.addEventListener('click', function () {
      var value = this.dataset.value;
      setActiveSortOpt(value);
      if (realSort) { realSort.value = value; fireChange(realSort); }
      // Sync filter panel select if open
      var fps = document.getElementById('mcf-sort-select');
      if (fps) fps.value = value;
      closeSortSheet();
    });
  });

  if (realSort) setActiveSortOpt(realSort.value || 'newest');

  /* ── Filter badge ─────────────────────────────────────── */

  var filterBadge = document.getElementById('mcf-filter-badge');

  function hasActiveFilters() {
    var q  = realSearch && realSearch.value.trim();
    var mn = realMin    && realMin.value.trim();
    var mx = realMax    && realMax.value.trim();
    var s  = realSort   && realSort.value !== 'newest';
    return !!(q || mn || mx || s);
  }

  function updateFilterBadge() {
    if (!filterBadge) return;
    filterBadge.classList.toggle('mcf-filter-badge--visible', hasActiveFilters());
  }

  [realSearch, realMin, realMax].forEach(function (el) {
    if (el) el.addEventListener('input', updateFilterBadge);
  });
  if (realSort) realSort.addEventListener('change', updateFilterBadge);

  /* ── Filter sheet ─────────────────────────────────────── */

  var filterBtn      = document.getElementById('mcf-filter-btn');
  var filterOverlay  = document.getElementById('mcf-filter-overlay');
  var filterSheet    = document.getElementById('mcf-filter-sheet');
  var filterClose    = document.getElementById('mcf-filter-close');
  var filterSearch   = document.getElementById('mcf-search');
  var filterSort     = document.getElementById('mcf-sort-select');
  var filterMin      = document.getElementById('mcf-price-min');
  var filterMax      = document.getElementById('mcf-price-max');
  var filterReset    = document.getElementById('mcf-reset-btn');
  var filterApply    = document.getElementById('mcf-apply-btn');

  function openFilterSheet() {
    if (!filterOverlay || !filterSheet) return;
    // Pre-populate from real inputs
    if (filterSearch && realSearch) filterSearch.value = realSearch.value;
    if (filterSort   && realSort)   filterSort.value   = realSort.value;
    if (filterMin    && realMin)    filterMin.value     = realMin.value;
    if (filterMax    && realMax)    filterMax.value     = realMax.value;

    filterOverlay.style.display = 'block';
    raf(function () {
      filterOverlay.classList.add('mcf-filter-overlay--open');
      filterSheet.classList.add('mcf-filter-sheet--open');
    });
    if (window.MBPanels) MBPanels.lockScroll();
    else document.body.style.overflow = 'hidden';
  }

  function closeFilterSheet() {
    if (!filterOverlay || !filterSheet) return;
    filterOverlay.classList.remove('mcf-filter-overlay--open');
    filterSheet.classList.remove('mcf-filter-sheet--open');
    if (window.MBPanels) MBPanels.unlockScroll();
    else document.body.style.overflow = '';
    setTimeout(function () { filterOverlay.style.display = 'none'; }, 300);
  }

  if (window.MBPanels) MBPanels.register('mcfFilter', closeFilterSheet);

  if (filterBtn)    filterBtn.addEventListener('click', openFilterSheet);
  if (filterClose)  filterClose.addEventListener('click', closeFilterSheet);
  if (filterOverlay) filterOverlay.addEventListener('click', closeFilterSheet);

  // Apply
  if (filterApply) {
    filterApply.addEventListener('click', function () {
      if (realSearch && filterSearch) { realSearch.value = filterSearch.value; fireInput(realSearch); }
      if (realSort   && filterSort)   { realSort.value   = filterSort.value;   fireChange(realSort);  setActiveSortOpt(filterSort.value); }
      if (realMin    && filterMin)    { realMin.value    = filterMin.value;    fireInput(realMin); }
      if (realMax    && filterMax)    { realMax.value    = filterMax.value;    fireInput(realMax); }
      updateFilterBadge();
      closeFilterSheet();
    });
  }

  // Reset
  if (filterReset) {
    filterReset.addEventListener('click', function () {
      if (filterSearch) filterSearch.value = '';
      if (filterSort)   filterSort.value   = 'newest';
      if (filterMin)    filterMin.value    = '';
      if (filterMax)    filterMax.value    = '';
      if (realClear)    realClear.click();
      setActiveSortOpt('newest');
      updateFilterBadge();
      closeFilterSheet();
    });
  }

  // "Narx" shortcut button
  var priceBtn = document.getElementById('mcf-price-btn');
  if (priceBtn) {
    priceBtn.addEventListener('click', function () {
      openFilterSheet();
      setTimeout(function () {
        var priceRow = document.querySelector('.mcf-price-row');
        if (priceRow) priceRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 340);
    });
  }

  /* ── View toggle (cosmetic) ───────────────────────────── */

  var viewBtns = document.querySelectorAll('.mcf-view-btn');
  viewBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      viewBtns.forEach(function (b) { b.classList.remove('mcf-view-btn--active'); });
      btn.classList.add('mcf-view-btn--active');
    });
  });

  /* ── Catalog overlay ──────────────────────────────────── */

  var mhcOverlay    = document.getElementById('mhc-overlay');
  var mhcDrawer     = document.getElementById('mhc-drawer');
  var mhcBackBtn    = document.getElementById('mhc-back-btn');
  var mhcCloseBtn   = document.getElementById('mhc-close-btn');
  var mhcList       = document.getElementById('mhc-list');
  var mhcSearchInput = document.getElementById('mhc-search-input');
  var mhcOpenBtn    = document.getElementById('mh-catalog-open-btn');

  // Category icon map — simple heuristics by keyword in category name
  var categoryIconMap = [
    { words: ['futbol', 'ko\'ylak', 'kiyim'],          icon: 'fa-tshirt',        color: '#dbeafe', fg: '#1d4ed8' },
    { words: ['oyoq', 'kross', 'tufli', 'tapochka'],   icon: 'fa-child',         color: '#dcfce7', fg: '#15803d' },
    { words: ['aksesuar', 'soat', 'kamar', 'ko\'z'],   icon: 'fa-diamond',       color: '#fce7f3', fg: '#be185d' },
    { words: ['shim', 'classik', 'casual'],             icon: 'fa-male',          color: '#ede9fe', fg: '#6d28d9' },
    { words: ['ustki', 'kurtka', 'jaket'],              icon: 'fa-umbrella',      color: '#fef3c7', fg: '#92400e' },
    { words: ['bosh', 'kepka'],                         icon: 'fa-certificate',   color: '#fee2e2', fg: '#b91c1c' },
    { words: ['jihozlar', 'qurilma'],                   icon: 'fa-cogs',          color: '#f0fdf4', fg: '#166534' },
    { words: ['sumka', 'bag'],                          icon: 'fa-shopping-bag',  color: '#fff7ed', fg: '#c2410c' },
    { words: ['yostiq', 'pillow'],                      icon: 'fa-bed',           color: '#ede9fe', fg: '#7c3aed' },
    { words: ['shampun', 'teri', 'parvar'],             icon: 'fa-leaf',          color: '#d1fae5', fg: '#065f46' },
  ];

  function getCategoryIcon(name) {
    var lc = (name || '').toLowerCase();
    for (var i = 0; i < categoryIconMap.length; i++) {
      var entry = categoryIconMap[i];
      for (var j = 0; j < entry.words.length; j++) {
        if (lc.indexOf(entry.words[j]) !== -1) {
          return { icon: entry.icon, color: entry.color, fg: entry.fg };
        }
      }
    }
    // Default
    return { icon: 'fa-tag', color: '#f3f4f6', fg: '#374151' };
  }

  // Build category rows from the real .shop-toolbar__filters buttons
  function buildCategoryRows() {
    if (!mhcList) return;
    var source = document.querySelectorAll('.shop-toolbar__filters .filter-btn');
    if (!source.length) return;

    // Remove previously injected rows (keep the static "Barchasi" row)
    var existing = mhcList.querySelectorAll('.mhc-row:not(.mhc-row--all)');
    existing.forEach(function (el) { el.remove(); });

    var active = document.querySelector('.shop-toolbar__filters .filter-btn.active');
    var activeVal = active ? active.dataset.category : '';

    source.forEach(function (btn) {
      var catName = btn.dataset.category;
      if (!catName) {
        // Update "Barchasi" active state
        var allRow = mhcList.querySelector('.mhc-row--all');
        if (allRow) allRow.classList.toggle('mhc-row--active', activeVal === '');
        return;
      }

      var iconInfo = getCategoryIcon(catName);
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'mhc-row' + (activeVal === catName ? ' mhc-row--active' : '');
      row.dataset.category = catName;
      row.setAttribute('role', 'listitem');
      row.innerHTML =
        '<span class="mhc-row__icon" style="background:' + iconInfo.color + ';color:' + iconInfo.fg + '">'
          + '<i class="fa ' + iconInfo.icon + '" aria-hidden="true"></i>'
        + '</span>'
        + '<span class="mhc-row__label">' + catName + '</span>'
        + '<i class="fa fa-angle-right mhc-row__arrow" aria-hidden="true"></i>';

      row.addEventListener('click', function () {
        selectCategory(catName, row);
      });

      mhcList.appendChild(row);
    });

    // Wire "Barchasi" row
    var allRow = mhcList.querySelector('.mhc-row--all');
    if (allRow) {
      allRow.classList.toggle('mhc-row--active', activeVal === '');
      // Re-bind (in case rebuilt)
      allRow.onclick = null;
      allRow.addEventListener('click', function () {
        selectCategory('', allRow);
      });
    }
  }

  // Select a category: click the matching real button, close overlay
  function selectCategory(catValue, rowEl) {
    // Mark active in overlay list
    mhcList.querySelectorAll('.mhc-row').forEach(function (r) { r.classList.remove('mhc-row--active'); });
    if (rowEl) rowEl.classList.add('mhc-row--active');

    // Find and click the real filter button
    var realBtns = document.querySelectorAll('.shop-toolbar__filters .filter-btn');
    var matched = false;
    realBtns.forEach(function (btn) {
      if (btn.dataset.category === catValue) {
        btn.click();
        matched = true;
      }
    });

    // If no real button found (race with async load), set directly
    if (!matched && realSearch) {
      // We'll wait and retry once
      setTimeout(function () {
        var btns2 = document.querySelectorAll('.shop-toolbar__filters .filter-btn');
        btns2.forEach(function (btn) {
          if (btn.dataset.category === catValue) btn.click();
        });
      }, 200);
    }

    closeCatalogOverlay();

    // Scroll to product grid
    setTimeout(function () {
      var grid = document.getElementById('shop-grid');
      if (!grid) return;
      var top = grid.getBoundingClientRect().top + window.pageYOffset - 12;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }, 320);
  }

  function openCatalogOverlay() {
    if (!mhcOverlay || !mhcDrawer) return;
    buildCategoryRows();
    mhcOverlay.style.display = 'block';
    mhcDrawer.style.display = 'block';
    raf(function () {
      mhcOverlay.classList.add('mhc-overlay--open');
      mhcDrawer.classList.add('mhc-drawer--open');
    });
    if (window.MBPanels) MBPanels.lockScroll();
    else document.body.style.overflow = 'hidden';
    if (mhcSearchInput) { mhcSearchInput.value = ''; filterCatRows(''); }
  }

  function closeCatalogOverlay() {
    if (!mhcOverlay || !mhcDrawer) return;
    mhcOverlay.classList.remove('mhc-overlay--open');
    mhcDrawer.classList.remove('mhc-drawer--open');
    if (window.MBPanels) MBPanels.unlockScroll();
    else document.body.style.overflow = '';
    setTimeout(function () {
      mhcOverlay.style.display = 'none';
      mhcDrawer.style.display = 'none';
    }, 300);
  }

  if (window.MBPanels) MBPanels.register('mcfCatalog', closeCatalogOverlay);

  if (mhcOpenBtn)   mhcOpenBtn.addEventListener('click', openCatalogOverlay);
  if (mhcBackBtn)   mhcBackBtn.addEventListener('click', closeCatalogOverlay);
  if (mhcCloseBtn)  mhcCloseBtn.addEventListener('click', closeCatalogOverlay);
  if (mhcOverlay)   mhcOverlay.addEventListener('click', closeCatalogOverlay);

  // Live search inside catalog
  function filterCatRows(q) {
    var lc = q.toLowerCase().trim();
    mhcList.querySelectorAll('.mhc-row').forEach(function (row) {
      var label = (row.querySelector('.mhc-row__label') || {}).textContent || '';
      row.classList.toggle('mhc-row--hidden', lc !== '' && label.toLowerCase().indexOf(lc) === -1);
    });
  }

  if (mhcSearchInput) {
    mhcSearchInput.addEventListener('input', function () {
      filterCatRows(this.value);
    });
  }

  // Watch real filter row for async population (shop-products.js loads async)
  var realFilterRow = document.querySelector('.shop-toolbar__filters');
  if (realFilterRow) {
    var catObserver = new MutationObserver(function () {
      buildCategoryRows();
    });
    catObserver.observe(realFilterRow, { childList: true });
  }

  // Also rebuild when active category changes (user clicks a real chip from desktop)
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.shop-toolbar__filters')) return;
    setTimeout(buildCategoryRows, 30);
  });

  /* ── Initial states ───────────────────────────────────── */
  updateFilterBadge();
  buildCategoryRows();

})();
