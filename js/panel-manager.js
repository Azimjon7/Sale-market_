/**
 * Sale Market — Panel Manager  (window.MBPanels)
 *
 * Centralises every scroll-lock and panel-close operation so that
 * any search trigger can call MBPanels.releaseAll() and be certain
 * that no stale overlay or body-overflow lock remains.
 *
 * Usage
 * ─────
 *   // Registration (called once by each panel module):
 *   MBPanels.register('sortPanel', closeSortFn);
 *
 *   // Release everything (called by search handlers):
 *   MBPanels.releaseAll();
 *
 *   // Scroll lock helpers used by panel open/close functions:
 *   MBPanels.lockScroll();
 *   MBPanels.unlockScroll();
 */

(function (global) {
  'use strict';

  var _closers  = {};          // name → close function
  var _lockDepth = 0;          // how many panels are currently open

  /* ── Scroll lock ─────────────────────────────────────────── */
  function lockScroll() {
    _lockDepth++;
    document.body.style.overflow = 'hidden';
  }

  function unlockScroll() {
    _lockDepth = Math.max(0, _lockDepth - 1);
    if (_lockDepth === 0) {
      _forceUnlockScroll();
    }
  }

  /* Hard reset — ignores depth counter, used by releaseAll */
  function _forceUnlockScroll() {
    _lockDepth = 0;

    // Inline style locks
    document.documentElement.style.overflow = '';
    document.documentElement.style.position = '';
    document.body.style.overflow   = '';
    document.body.style.position   = '';
    document.body.style.top        = '';
    document.body.style.width      = '';
    document.body.style.height     = '';
    document.body.style.touchAction = '';

    // Class-based locks (Bootstrap, custom)
    var lockClasses = [
      'menu-open', 'modal-open', 'drawer-open',
      'no-scroll', 'overflow-hidden', 'search-open',
      'nav-open', 'panel-open'
    ];
    document.documentElement.classList.remove.apply(
      document.documentElement.classList, lockClasses
    );
    document.body.classList.remove.apply(
      document.body.classList, lockClasses
    );
  }

  /* ── Panel registry ──────────────────────────────────────── */
  function register(name, closeFn) {
    if (typeof closeFn === 'function') {
      _closers[name] = closeFn;
    }
  }

  function unregister(name) {
    delete _closers[name];
  }

  /* ── Release all ─────────────────────────────────────────── */
  function releaseAll() {
    // Call every registered close function silently
    var names = Object.keys(_closers);
    for (var i = 0; i < names.length; i++) {
      try { _closers[names[i]](); } catch (e) { /* ignore */ }
    }

    // Force-close the hamburger nav overlay if it is open
    var navOverlay = document.getElementById('mh-nav-overlay');
    var mobileNav  = document.querySelector('.mh-mobile-nav');
    var toggler    = document.querySelector('.mh-hamburger');
    if (mobileNav && mobileNav.classList.contains('mh-mobile-nav--open')) {
      mobileNav.classList.remove('mh-mobile-nav--open');
      mobileNav.setAttribute('aria-hidden', 'true');
      if (toggler) toggler.setAttribute('aria-expanded', 'false');
    }
    if (navOverlay) navOverlay.classList.remove('mh-nav-overlay--visible');

    // Force-close the "Ko'proq" bottom drawer if it is open
    var moreDrawer  = document.getElementById('mb-more-drawer');
    var moreOverlay = document.getElementById('mb-more-overlay');
    var moreBtn     = document.getElementById('mb-more-btn');
    if (moreDrawer)  moreDrawer.classList.remove('mb-more-drawer--open');
    if (moreOverlay) moreOverlay.classList.remove('mb-overlay--visible');
    if (moreBtn)     moreBtn.setAttribute('aria-expanded', 'false');

    // Force-clear any overlay display:block that the JS setTimeout hasn't cleaned yet
    var overlayIds = [
      'sct-sort-overlay', 'sct-filter-overlay',
      'sct-cat-backdrop',
      'mhc-overlay',
    ];
    overlayIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        // Remove all open classes
        el.className = el.className
          .replace(/\S+--open\b/g, '')
          .replace(/\S+--visible\b/g, '')
          .trim();
        // Don't touch display here — rely on pointer-events:none in CSS
      }
    });

    // Also handle dynamically created overlays in mobile-catalog-filter.js
    var mcfIds = ['mcf-sort-overlay', 'mcf-filter-overlay'];
    mcfIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.className = el.className
          .replace(/\S+--open\b/g, '')
          .trim();
      }
    });

    // Always hard-reset scroll lock last
    _forceUnlockScroll();
  }

  /* ── Expose ──────────────────────────────────────────────── */
  global.MBPanels = {
    register      : register,
    unregister    : unregister,
    lockScroll    : lockScroll,
    unlockScroll  : unlockScroll,
    releaseAll    : releaseAll,
    /** Direct access for panel modules that need to force-unlock */
    forceUnlock   : _forceUnlockScroll,
  };

})(window);
