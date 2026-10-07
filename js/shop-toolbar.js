/**
 * Sale Market — Shop Compact Toolbar
 *
 * Works on BOTH desktop and mobile (≤768px / ≥769px).
 *
 * Responsibilities:
 *   1. Mirror #shop-count → #sct-count-text
 *   2. Sort panel (Saralash button) — bottom sheet mobile, modal desktop
 *   3. Filter panel (Filtr button)  — bottom sheet mobile, modal desktop
 *   4. Category dropdown (desktop Katalog btn + mobile catalog drawer)
 *        – desktop: .sct-btn--cat → .sct-cat-dropdown anchored dropdown
 *        – mobile:  header yellow btn + .sct-btn--cat → .mhc-drawer left drawer
 *   5. Filter badge on Filtr button
 *   6. Reuse existing real inputs — push values and fire events for shop-products.js
 *
 * No filter logic is duplicated — shop-products.js owns all filtering.
 */

(function () {
  'use strict';

  var isMobile = function () { return window.innerWidth <= 768; };

  /* ── DOM refs: real (hidden) inputs ─────────────────────── */
  var realSearch = document.getElementById('shop-search');
  var realSort   = document.getElementById('shop-sort');
  var realMin    = document.getElementById('shop-price-min');
  var realMax    = document.getElementById('shop-price-max');
  var realClear  = document.getElementById('shop-clear-filters');
  var realCount  = document.getElementById('shop-count');

  /* ── DOM refs: toolbar ──────────────────────────────────── */
  var sctCountEl    = document.getElementById('sct-count-text');
  var sctSortBtn    = document.getElementById('sct-sort-btn');
  var sctFilterBtn  = document.getElementById('sct-filter-btn');
  var sctCatBtn     = document.getElementById('sct-cat-btn');
  var sctCatLabel   = document.getElementById('sct-cat-label');
  var sctFilterBadge = document.getElementById('sct-filter-badge');

  /* ── DOM refs: sort panel ───────────────────────────────── */
  var sortOverlay = document.getElementById('sct-sort-overlay');
  var sortPanel   = document.getElementById('sct-sort-panel');
  var sortClose   = document.getElementById('sct-sort-close');
  var sortOpts    = document.querySelectorAll('.sct-sort-opt');

  /* ── DOM refs: filter panel ─────────────────────────────── */
  var filterOverlay = document.getElementById('sct-filter-overlay');
  var filterPanel   = document.getElementById('sct-filter-panel');
  var filterClose   = document.getElementById('sct-filter-close');
  var filterSearch  = document.getElementById('sct-search');
  var filterMin     = document.getElementById('sct-price-min');
  var filterMax     = document.getElementById('sct-price-max');
  var filterReset   = document.getElementById('sct-reset-btn');
  var filterApply   = document.getElementById('sct-apply-btn');

  /* ── DOM refs: desktop category dropdown ────────────────── */
  var catBackdrop  = document.getElementById('sct-cat-backdrop');
  var catDropdown  = document.getElementById('sct-cat-dropdown');
  var catClose     = document.getElementById('sct-cat-close');
  var catList      = document.getElementById('sct-cat-list');

  /* ── DOM refs: mobile catalog drawer ────────────────────── */
  var mhcOverlay    = document.getElementById('mhc-overlay');
  var mhcDrawer     = document.getElementById('mhc-drawer');
  var mhcBack       = document.getElementById('mhc-back-btn');
  var mhcClose      = document.getElementById('mhc-close-btn');
  var mhcList       = document.getElementById('mhc-list');
  var mhcSearchInput = document.getElementById('mhc-search-input');
  var mhcOpenBtn    = document.getElementById('mh-catalog-open-btn');

  /* ── DOM refs: header desktop catalog btn ───────────────── */
  var headerCatBtn = document.querySelector('.market-catalog-btn');

  /* ── Helpers ─────────────────────────────────────────────── */

  function fireInput(el) { if (el) el.dispatchEvent(new Event('input',  { bubbles: true })); }
  function fireChange(el){ if (el) el.dispatchEvent(new Event('change', { bubbles: true })); }
  function raf(fn) { requestAnimationFrame(fn); }

  /* ── 1. Count mirror ─────────────────────────────────────── */

  if (realCount && sctCountEl) {
    new MutationObserver(function () {
      sctCountEl.textContent = realCount.textContent;
    }).observe(realCount, { childList: true, characterData: true, subtree: true });
    sctCountEl.textContent = realCount.textContent;
  }

  /* ── 2. Sort panel ───────────────────────────────────────── */

  var sortLabels = {
    newest:        'Saralash',
    price_asc:     'Narx ↑',
    price_desc:    'Narx ↓',
    most_reviewed: 'Mashhur',
  };

  function setActiveSortOpt(value) {
    sortOpts.forEach(function (opt) {
      opt.classList.toggle('sct-sort-opt--active', opt.dataset.value === value);
    });
    var label = sctSortBtn && sctSortBtn.querySelector('span');
    if (label) label.textContent = sortLabels[value] || 'Saralash';
    if (sctSortBtn) sctSortBtn.classList.toggle('sct-btn--active', value && value !== 'newest');
  }

  function openSortPanel() {
    if (!sortOverlay || !sortPanel) return;
    sortOverlay.style.display = 'block';
    sortPanel.style.display = 'flex';
    raf(function () {
      sortOverlay.classList.add('sct-sort-overlay--open');
      sortPanel.classList.add('sct-sort-panel--open');
    });
    if (window.MBPanels) MBPanels.lockScroll();
    else document.body.style.overflow = 'hidden';
  }

  function closeSortPanel() {
    if (!sortOverlay || !sortPanel) return;
    sortOverlay.classList.remove('sct-sort-overlay--open');
    sortPanel.classList.remove('sct-sort-panel--open');
    if (window.MBPanels) MBPanels.unlockScroll();
    else document.body.style.overflow = '';
    setTimeout(function () {
      sortOverlay.style.display = 'none';
      sortPanel.style.display = 'none';
    }, 280);
  }

  /* register with panel manager so releaseAll() can close this */
  if (window.MBPanels) MBPanels.register('sctSort', closeSortPanel);

  if (sctSortBtn) sctSortBtn.addEventListener('click', openSortPanel);
  if (sortClose)  sortClose.addEventListener('click', closeSortPanel);
  if (sortOverlay) sortOverlay.addEventListener('click', closeSortPanel);

  sortOpts.forEach(function (opt) {
    opt.addEventListener('click', function () {
      var val = this.dataset.value;
      setActiveSortOpt(val);
      if (realSort) { realSort.value = val; fireChange(realSort); }
      closeSortPanel();
    });
  });

  if (realSort) setActiveSortOpt(realSort.value || 'newest');

  /* ── 3. Filter badge ─────────────────────────────────────── */

  function hasActiveFilters() {
    var q  = realSearch && realSearch.value.trim();
    var mn = realMin    && realMin.value.trim();
    var mx = realMax    && realMax.value.trim();
    var s  = realSort   && realSort.value !== 'newest';
    return !!(q || mn || mx || s);
  }

  function updateBadge() {
    if (sctFilterBadge) sctFilterBadge.classList.toggle('sct-badge--on', hasActiveFilters());
    if (sctFilterBtn) sctFilterBtn.classList.toggle('sct-btn--active', hasActiveFilters());
  }

  [realSearch, realMin, realMax].forEach(function (el) {
    if (el) el.addEventListener('input', updateBadge);
  });
  if (realSort) realSort.addEventListener('change', updateBadge);

  /* ── 4. Filter panel ─────────────────────────────────────── */

  function openFilterPanel() {
    if (!filterOverlay || !filterPanel) return;
    if (filterSearch && realSearch) filterSearch.value = realSearch.value;
    if (filterMin    && realMin)    filterMin.value    = realMin.value;
    if (filterMax    && realMax)    filterMax.value    = realMax.value;

    filterOverlay.style.display = 'block';
    filterPanel.style.display   = 'flex';
    raf(function () {
      filterOverlay.classList.add('sct-filter-overlay--open');
      filterPanel.classList.add('sct-filter-panel--open');
    });
    if (window.MBPanels) MBPanels.lockScroll();
    else document.body.style.overflow = 'hidden';
  }

  function closeFilterPanel() {
    if (!filterOverlay || !filterPanel) return;
    filterOverlay.classList.remove('sct-filter-overlay--open');
    filterPanel.classList.remove('sct-filter-panel--open');
    if (window.MBPanels) MBPanels.unlockScroll();
    else document.body.style.overflow = '';
    setTimeout(function () {
      filterOverlay.style.display = 'none';
      filterPanel.style.display   = 'none';
    }, 300);
  }

  /* register with panel manager */
  if (window.MBPanels) MBPanels.register('sctFilter', closeFilterPanel);

  if (sctFilterBtn)  sctFilterBtn.addEventListener('click', openFilterPanel);
  if (filterClose)   filterClose.addEventListener('click', closeFilterPanel);
  if (filterOverlay) filterOverlay.addEventListener('click', closeFilterPanel);

  if (filterApply) {
    filterApply.addEventListener('click', function () {
      if (realSearch && filterSearch) { realSearch.value = filterSearch.value; fireInput(realSearch); }
      if (realMin    && filterMin)    { realMin.value    = filterMin.value;    fireInput(realMin); }
      if (realMax    && filterMax)    { realMax.value    = filterMax.value;    fireInput(realMax); }
      updateBadge();
      closeFilterPanel();
    });
  }

  // Live search: sync visible input → hidden input on every keystroke
  if (filterSearch) {
    filterSearch.addEventListener('input', function () {
      if (realSearch) {
        realSearch.value = filterSearch.value;
        fireInput(realSearch);
      }
      updateBadge();
    });
    filterSearch.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (realSearch) { realSearch.value = filterSearch.value; fireInput(realSearch); }
        updateBadge();
        closeFilterPanel();
      }
    });
  }

  if (filterReset) {
    filterReset.addEventListener('click', function () {
      if (filterSearch) filterSearch.value = '';
      if (filterMin)    filterMin.value    = '';
      if (filterMax)    filterMax.value    = '';
      if (realClear)    realClear.click();
      updateBadge();
      closeFilterPanel();
    });
  }

  /* ── 5. Category handling (shared logic) ─────────────────── */

  var categoryIconMap = [
    { words: ['ayollar kiyimi'],                    icon:'fa-female',       bg:'#fce7f3', fg:'#be185d' },
    { words: ['erkaklar kiyimi'],                   icon:'fa-male',         bg:'#dbeafe', fg:'#1d4ed8' },
    { words: ['ayollar poyabzali'],                 icon:'fa-female',       bg:'#fdf2f8', fg:'#9d174d' },
    { words: ['erkaklar poyabzali'],                icon:'fa-male',         bg:'#eff6ff', fg:'#1e40af' },
    { words: ['futbol','ko\'ylak','kiyim'],       icon:'fa-user',         bg:'#dbeafe', fg:'#1d4ed8' },
    { words: ['oyoq','kross','tufli','tapochka'],   icon:'fa-child',        bg:'#dcfce7', fg:'#15803d' },
    { words: ['aksesuar','soat','kamar','ko\'z'], icon:'fa-diamond',      bg:'#fce7f3', fg:'#be185d' },
    { words: ['shim','classik','casual'],           icon:'fa-male',         bg:'#ede9fe', fg:'#6d28d9' },
    { words: ['ustki','kurtka','jaket'],            icon:'fa-umbrella',     bg:'#fef3c7', fg:'#92400e' },
    { words: ['bosh','kepka'],                      icon:'fa-certificate',  bg:'#fee2e2', fg:'#b91c1c' },
    { words: ['oshxona'],                           icon:'fa-cutlery',      bg:'#fff7ed', fg:'#c2410c' },
    { words: ['tozalash'],                          icon:'fa-magic',        bg:'#ecfeff', fg:'#0e7490' },
    { words: ['yoritish','led'],                    icon:'fa-lightbulb-o',  bg:'#fef9c3', fg:'#a16207' },
    { words: ['sport'],                             icon:'fa-futbol-o',     bg:'#dcfce7', fg:'#166534' },
    { words: ['bolalar'],                           icon:'fa-child',        bg:'#fef3c7', fg:'#b45309' },
    { words: ['go‘zallik','go\'zallik','shampun','teri','parvar'], icon:'fa-heart', bg:'#fce7f3', fg:'#be185d' },
    { words: ['elektronika'],                       icon:'fa-plug',         bg:'#eef2ff', fg:'#4338ca' },
    { words: ['parfyumeriya','atir'],               icon:'fa-diamond',      bg:'#f5f3ff', fg:'#7c3aed' },
    { words: ['avtomobil','avto'],                  icon:'fa-car',          bg:'#f1f5f9', fg:'#334155' },
    { words: ['uy jihozlari','jihozlar','qurilma'], icon:'fa-home',         bg:'#ecfdf5', fg:'#047857' },
    { words: ['mebel','furniture'],                 icon:'fa-home',         bg:'#f3f4f6', fg:'#374151' },
    { words: ['sumka','bag'],                       icon:'fa-shopping-bag', bg:'#fff7ed', fg:'#c2410c' },
    { words: ['yostiq','pillow'],                   icon:'fa-bed',          bg:'#ede9fe', fg:'#7c3aed' },
  ];

  function getCatIcon(name) {
    var lc = (name || '').toLowerCase();
    for (var i = 0; i < categoryIconMap.length; i++) {
      for (var j = 0; j < categoryIconMap[i].words.length; j++) {
        if (lc.indexOf(categoryIconMap[i].words[j]) !== -1) return categoryIconMap[i];
      }
    }
    return { icon:'fa-tag', bg:'#f3f4f6', fg:'#374151' };
  }

  function getActiveCatValue() {
    var btn = document.querySelector('.shop-toolbar__filters .filter-btn.active');
    return btn ? btn.dataset.category : '';
  }

  // Update the toolbar category button label
  function updateCatBtnLabel(catName) {
    if (sctCatLabel) sctCatLabel.textContent = catName || 'Barchasi';
    if (sctCatBtn)   sctCatBtn.classList.toggle('sct-btn--active', !!catName);
  }

  // Apply a category selection: click real button, update UI, close panels, scroll
  function selectCategory(catValue) {
    var realBtns = document.querySelectorAll('.shop-toolbar__filters .filter-btn');
    var found = false;
    realBtns.forEach(function (btn) {
      if (btn.dataset.category === catValue) { btn.click(); found = true; }
    });
    if (!found) {
      // Race condition: retry once after a short delay
      setTimeout(function () {
        document.querySelectorAll('.shop-toolbar__filters .filter-btn').forEach(function (btn) {
          if (btn.dataset.category === catValue) btn.click();
        });
      }, 200);
    }
    updateCatBtnLabel(catValue);

    // Scroll to grid
    setTimeout(function () {
      var grid = document.getElementById('shop-grid');
      if (!grid) return;
      var top = grid.getBoundingClientRect().top + window.pageYOffset - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 320);
  }

  // Rebuild desktop dropdown rows
  function buildDesktopCatRows() {
    if (!catList) return;
    var active = getActiveCatValue();

    // Remove previously injected rows
    catList.querySelectorAll('.sct-cat-row:not(.sct-cat-row--all)').forEach(function (r) { r.remove(); });

    // Update "Barchasi" active state
    var allRow = catList.querySelector('.sct-cat-row--all');
    if (allRow) allRow.classList.toggle('sct-cat-row--active', active === '');

    document.querySelectorAll('.shop-toolbar__filters .filter-btn').forEach(function (btn) {
      var cat = btn.dataset.category;
      if (!cat) return;
      var ic = getCatIcon(cat);
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'sct-cat-row' + (active === cat ? ' sct-cat-row--active' : '');
      row.dataset.category = cat;
      row.setAttribute('role', 'listitem');
      var count = Number(btn.dataset.count || 0);
      row.innerHTML =
        '<span class="sct-cat-row__icon" style="background:' + ic.bg + ';color:' + ic.fg + '">'
          + '<i class="fa ' + ic.icon + '" aria-hidden="true"></i></span>'
        + '<span class="sct-cat-row__label">' + cat + '</span>'
        + '<span class="sct-cat-row__count">' + count + '</span>'
        + '<i class="fa fa-check sct-cat-row__check" aria-hidden="true"></i>';
      row.addEventListener('click', function () {
        catList.querySelectorAll('.sct-cat-row').forEach(function (r) { r.classList.remove('sct-cat-row--active'); });
        row.classList.add('sct-cat-row--active');
        selectCategory(cat);
        closeDesktopCatDropdown();
      });
      catList.appendChild(row);
    });

    // Re-bind "Barchasi"
    if (allRow) {
      allRow.onclick = null;
      allRow.addEventListener('click', function () {
        catList.querySelectorAll('.sct-cat-row').forEach(function (r) { r.classList.remove('sct-cat-row--active'); });
        allRow.classList.add('sct-cat-row--active');
        selectCategory('');
        closeDesktopCatDropdown();
      });
    }
  }

  // Rebuild mobile drawer rows
  function buildMobileCatRows() {
    if (!mhcList) return;
    var active = getActiveCatValue();
    mhcList.querySelectorAll('.mhc-row:not(.mhc-row--all)').forEach(function (r) { r.remove(); });

    var allRow = mhcList.querySelector('.mhc-row--all');
    if (allRow) allRow.classList.toggle('mhc-row--active', active === '');

    document.querySelectorAll('.shop-toolbar__filters .filter-btn').forEach(function (btn) {
      var cat = btn.dataset.category;
      if (!cat) return;
      var ic = getCatIcon(cat);
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'mhc-row' + (active === cat ? ' mhc-row--active' : '');
      row.dataset.category = cat;
      row.setAttribute('role', 'listitem');
      var count = Number(btn.dataset.count || 0);
      row.innerHTML =
        '<span class="mhc-row__icon" style="background:' + ic.bg + ';color:' + ic.fg + '">'
          + '<i class="fa ' + ic.icon + '" aria-hidden="true"></i></span>'
        + '<span class="mhc-row__label">' + cat + '</span>'
        + '<span class="mhc-row__count">' + count + '</span>'
        + '<i class="fa fa-angle-right mhc-row__arrow" aria-hidden="true"></i>';
      row.addEventListener('click', function () {
        selectCategory(cat);
        closeMobileDrawer();
      });
      mhcList.appendChild(row);
    });

    if (allRow) {
      allRow.onclick = null;
      allRow.addEventListener('click', function () {
        selectCategory('');
        closeMobileDrawer();
      });
    }
  }

  /* ── 6. Desktop catalog dropdown ─────────────────────────── */

  function openDesktopCatDropdown() {
    if (!catDropdown) return;
    buildDesktopCatRows();
    catDropdown.style.display = 'flex';

    // Position below the trigger button
    var trigger = sctCatBtn || headerCatBtn;
    if (trigger) {
      var rect = trigger.getBoundingClientRect();
      var scrollY = window.pageYOffset;
      var scrollX = window.pageXOffset;
      var dropW = Math.min(560, window.innerWidth - 32);
      var left = rect.left + scrollX;
      // Keep on screen
      if (left + dropW > window.innerWidth - 16) left = window.innerWidth - dropW - 16;
      catDropdown.style.top  = (rect.bottom + scrollY + 6) + 'px';
      catDropdown.style.left = left + 'px';
      catDropdown.style.width = dropW + 'px';
    }

    raf(function () {
      catDropdown.classList.add('sct-cat-dropdown--open');
    });
  }

  function closeDesktopCatDropdown() {
    if (!catDropdown) return;
    catDropdown.classList.remove('sct-cat-dropdown--open');
    setTimeout(function () { catDropdown.style.display = 'none'; }, 180);
  }

  function toggleDesktopCatDropdown() {
    if (catDropdown && catDropdown.style.display === 'flex') {
      closeDesktopCatDropdown();
    } else {
      openDesktopCatDropdown();
    }
  }

  // Add open class style for dropdown
  var dropdownStyle = document.createElement('style');
  dropdownStyle.textContent = '.sct-cat-dropdown--open { display: flex !important; }';
  document.head.appendChild(dropdownStyle);

  // Close on outside click
  document.addEventListener('click', function (e) {
    if (!catDropdown) return;
    if (catDropdown.style.display !== 'flex') return;
    if (catDropdown.contains(e.target)) return;
    if (sctCatBtn && sctCatBtn.contains(e.target)) return;
    if (headerCatBtn && headerCatBtn.contains(e.target)) return;
    closeDesktopCatDropdown();
  });

  if (sctCatBtn) {
    sctCatBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isMobile()) {
        openMobileDrawer();
      } else {
        toggleDesktopCatDropdown();
      }
    });
  }

  if (headerCatBtn) {
    headerCatBtn.addEventListener('click', function (e) {
      if (isMobile()) return; // mobile uses mhcOpenBtn
      e.preventDefault();
      e.stopPropagation();
      toggleDesktopCatDropdown();
    });
  }

  if (catClose) catClose.addEventListener('click', closeDesktopCatDropdown);

  /* ── 7. Mobile catalog drawer ────────────────────────────── */

  function openMobileDrawer() {
    if (!mhcOverlay || !mhcDrawer) return;
    buildMobileCatRows();
    if (mhcSearchInput) { mhcSearchInput.value = ''; filterMobileRows(''); }
    mhcOverlay.style.display = 'block';
    mhcDrawer.style.display  = 'block';
    raf(function () {
      mhcOverlay.classList.add('mhc-overlay--open');
      mhcDrawer.classList.add('mhc-drawer--open');
    });
    if (window.MBPanels) MBPanels.lockScroll();
    else document.body.style.overflow = 'hidden';
  }

  function closeMobileDrawer() {
    if (!mhcOverlay || !mhcDrawer) return;
    mhcOverlay.classList.remove('mhc-overlay--open');
    mhcDrawer.classList.remove('mhc-drawer--open');
    if (window.MBPanels) MBPanels.unlockScroll();
    else document.body.style.overflow = '';
    setTimeout(function () {
      mhcOverlay.style.display = 'none';
      mhcDrawer.style.display  = 'none';
    }, 300);
  }

  /* register with panel manager */
  if (window.MBPanels) MBPanels.register('mhcDrawer', closeMobileDrawer);

  function filterMobileRows(q) {
    var lc = q.toLowerCase().trim();
    if (!mhcList) return;
    mhcList.querySelectorAll('.mhc-row').forEach(function (row) {
      var lbl = (row.querySelector('.mhc-row__label') || {}).textContent || '';
      row.classList.toggle('mhc-row--hidden', lc !== '' && lbl.toLowerCase().indexOf(lc) === -1);
    });
  }

  if (mhcOpenBtn)  mhcOpenBtn.addEventListener('click', openMobileDrawer);
  if (mhcBack)     mhcBack.addEventListener('click', closeMobileDrawer);
  if (mhcClose)    mhcClose.addEventListener('click', closeMobileDrawer);
  if (mhcOverlay)  mhcOverlay.addEventListener('click', closeMobileDrawer);
  if (mhcSearchInput) {
    mhcSearchInput.addEventListener('input', function () { filterMobileRows(this.value); });
  }

  // Also wire the mobile toolbar cat button to drawer
  // (Already done above via isMobile() check in sct-cat-btn click)

  /* ── 8. Sync category rows when shop-products.js populates them ── */

  var realFilterRow = document.querySelector('.shop-toolbar__filters');
  if (realFilterRow) {
    new MutationObserver(function () {
      buildDesktopCatRows();
      buildMobileCatRows();
      updateCatBtnLabel(getActiveCatValue());
    }).observe(realFilterRow, { childList: true });
  }

  // Keep cat label in sync when real buttons are clicked (e.g. URL param)
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.shop-toolbar__filters')) return;
    setTimeout(function () {
      updateCatBtnLabel(getActiveCatValue());
      buildDesktopCatRows();
      buildMobileCatRows();
    }, 40);
  });

  /* ── 9. Initial state ────────────────────────────────────── */
  updateBadge();
  updateCatBtnLabel(getActiveCatValue());
  buildDesktopCatRows();
  buildMobileCatRows();

})();
