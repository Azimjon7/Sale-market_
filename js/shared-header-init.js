/**
 * Sale Market — Shared Header Init
 * - Sets active nav link based on current page filename
 * - Syncs all .js-cart-count badges from localStorage
 * - Wires the search form to navigate to shop.html?search=...
 * - Wires hamburger mobile menu toggle
 */
(function () {
  'use strict';

  /* ── Active nav link ─────────────────────────────────────── */
  function setActiveNav() {
    var page = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var navLinks = document.querySelectorAll('.market-nav a, .mh-mobile-nav a');
    navLinks.forEach(function (link) {
      var href = (link.getAttribute('href') || '').split('?')[0].toLowerCase();
      if (href === page || (page === '' && href === 'index.html')) {
        link.parentElement.classList.add('active');
      } else {
        link.parentElement.classList.remove('active');
      }
    });
  }

  /* ── Cart count badge ─────────────────────────────────────── */
  function updateCartCount() {
    try {
      var cart = [];
      if (window.MBStore && typeof window.MBStore.getCart === 'function') {
        cart = window.MBStore.getCart();
      } else {
        var raw = localStorage.getItem('mujskoy_cart') || localStorage.getItem('mb_cart') || '[]';
        cart = JSON.parse(raw);
        if (!Array.isArray(cart)) cart = [];
      }
      var count = cart.reduce(function (sum, item) {
        return sum + Math.max(0, Number(item.qty) || 1);
      }, 0);
      document.querySelectorAll('.js-cart-count, .market-cart-tip').forEach(function (el) {
        el.textContent = count;
      });
    } catch (e) {}
  }

  /* ── Search form ──────────────────────────────────────────── */
  function bindSearch() {
    document.querySelectorAll('.js-market-search').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = form.querySelector('input[type="search"], input[name="q"]');
        var query = (input && input.value || '').trim();
        window.location.href = 'shop.html' + (query ? '?search=' + encodeURIComponent(query) : '');
      });
    });
  }

  /* ── Mobile hamburger ─────────────────────────────────────── */
  function bindMobileMenu() {
    var toggler   = document.querySelector('.mh-hamburger');
    var mobileNav = document.querySelector('.mh-mobile-nav');
    if (!toggler || !mobileNav) return;

    /* Create and insert the overlay element once */
    var overlay = document.getElementById('mh-nav-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mh-nav-overlay';
      overlay.className = 'mh-nav-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      // Insert directly before the drawer so stacking context is correct
      mobileNav.parentNode.insertBefore(overlay, mobileNav);
    }

    function openMenu() {
      mobileNav.classList.add('mh-mobile-nav--open');
      mobileNav.setAttribute('aria-hidden', 'false');
      toggler.setAttribute('aria-expanded', 'true');
      overlay.classList.add('mh-nav-overlay--visible');
      if (window.MBPanels) MBPanels.lockScroll();
      else document.body.style.overflow = 'hidden';
    }

    function closeMenu() {
      mobileNav.classList.remove('mh-mobile-nav--open');
      mobileNav.setAttribute('aria-hidden', 'true');
      toggler.setAttribute('aria-expanded', 'false');
      overlay.classList.remove('mh-nav-overlay--visible');
      if (window.MBPanels) MBPanels.unlockScroll();
      else {
        setTimeout(function () { document.body.style.overflow = ''; }, 260);
      }
    }

    /* Register so releaseAll() can close this too */
    if (window.MBPanels) MBPanels.register('hamburgerNav', closeMenu);

    /* Toggle on hamburger click */
    toggler.addEventListener('click', function (e) {
      e.stopPropagation();
      mobileNav.classList.contains('mh-mobile-nav--open') ? closeMenu() : openMenu();
    });

    /* Close when tapping the overlay (outside the white panel) */
    overlay.addEventListener('click', closeMenu);

    /* Close on any nav link tap */
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });

    /* Close on Escape key (desktop accessibility) */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobileNav.classList.contains('mh-mobile-nav--open')) {
        closeMenu();
        toggler.focus();
      }
    });
  }

  /* ── Init ─────────────────────────────────────────────────── */
  function init() {
    setActiveNav();
    updateCartCount();
    bindSearch();
    bindMobileMenu();
  }

  /* Re-run cart count whenever localStorage changes (e.g. user adds item) */
  window.addEventListener('storage', updateCartCount);
  document.addEventListener('mb:cart-updated', updateCartCount);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
