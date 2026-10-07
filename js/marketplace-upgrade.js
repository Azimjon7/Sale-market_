
(function(){
  function qs(s){return document.querySelector(s)}
  function qsa(s){return Array.from(document.querySelectorAll(s))}
  function updateMarketCart(){
    try{var cart=window.MBStore&&MBStore.getCart?MBStore.getCart():JSON.parse(localStorage.getItem('mujskoy_cart')||localStorage.getItem('mb_cart')||'[]');var count=cart.reduce(function(s,i){return s+Number(i.qty||1)},0);qsa('.js-cart-count,.market-cart-tip').forEach(function(el){el.textContent=count})}catch(e){}
  }
  function bindSearch(){
    qsa('.js-market-search').forEach(function(form){form.addEventListener('submit',function(e){e.preventDefault();var input=form.querySelector('input');var q=(input&&input.value||'').trim();window.location.href='shop.html'+(q?'?q='+encodeURIComponent(q):'');})})
  }
  function applySearchFromUrl(){
    var p=new URLSearchParams(location.search);
    var q=(p.get('search')||p.get('q')||'').trim();
    if(!q) return;
    // Seed all visible + hidden inputs — the page-specific JS (shop-products / index-products)
    // reads these on load and applies the filter itself.
    ['sct-search','mcf-search','shop-search'].forEach(function(id){
      var el=document.getElementById(id);if(el)el.value=q;
    });
    // Trigger shop-products filter after it has had time to load products
    setTimeout(function(){
      var hidden=document.getElementById('shop-search');
      if(hidden) hidden.dispatchEvent(new Event('input',{bubbles:true}));
    },600);
  }
  function timer(){
    var root=qs('[data-market-timer]'); if(!root) return; var end=Date.now()+1000*60*60*8+1000*60*17+1000*44;
    function tick(){var left=Math.max(0,end-Date.now());var h=Math.floor(left/36e5);var m=Math.floor(left%36e5/6e4);var s=Math.floor(left%6e4/1000);root.innerHTML='<span>'+String(h).padStart(2,'0')+'</span><span>'+String(m).padStart(2,'0')+'</span><span>'+String(s).padStart(2,'0')+'</span>';}
    tick();setInterval(tick,1000);
  }
  document.addEventListener('DOMContentLoaded',function(){updateMarketCart();bindSearch();applySearchFromUrl();timer();});
  window.addEventListener('storage',updateMarketCart);
})();


/* ─── Mobile Bottom Navigation ─────────────────────────────────────────────
   Injects a fixed bottom nav bar on mobile (≤ 768px) only.
   5 primary tabs: Bosh sahifa | Katalog | Savat | Buyurtma | Ko'proq
   "Ko'proq" opens a small drawer with secondary links.
   Automatically highlights the active tab based on current page.
   Removes .market-nav from header on mobile to eliminate the broken scroll.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  var BREAKPOINT = 768;

  var NAV_ITEMS = [
    { id: 'home',    href: 'index.html',       icon: 'fa-home',          label: 'Bosh sahifa' },
    { id: 'cart',    href: 'shop-cart.html',    icon: 'fa-shopping-bag',  label: 'Savat', cart: true },
    { id: 'order',   href: 'checkout.html',     icon: 'fa-clipboard',     label: 'Buyurtma' },
    { id: 'more',    href: '#',                 icon: 'fa-ellipsis-h',    label: 'Ko\'proq', more: true }
  ];

  var MORE_ITEMS = [
    { href: 'track-order.html', icon: 'fa-truck',    label: 'Buyurtmani kuzatish' },
    { href: 'contact.html',     icon: 'fa-envelope', label: 'Bog\'lanish' },
    { href: 'admin.html',       icon: 'fa-user-o',   label: 'Boshqaruv' }
  ];

  function currentPage() {
    return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  }

  function activeId() {
    var page = currentPage();
    if (page === '' || page === 'index.html' || page === 'main.html') return 'home';
    if (page === 'shop-cart.html') return 'cart';
    if (page === 'checkout.html' || page === 'success.html') return 'order';
    if (page === 'track-order.html' || page === 'contact.html' || page === 'admin.html' || page === 'shop.html' || page === 'product-details.html') return 'more';
    return '';
  }

  function cartCount() {
    try {
      var cart = window.MBStore && MBStore.getCart ? MBStore.getCart()
        : JSON.parse(localStorage.getItem('mujskoy_cart') || localStorage.getItem('mb_cart') || '[]');
      return cart.reduce(function (s, i) { return s + Number(i.qty || 1); }, 0);
    } catch (e) { return 0; }
  }

  function buildNav() {
    if (window.innerWidth > BREAKPOINT) return;
    if (document.getElementById('mb-bottom-nav')) return;

    var active = activeId();
    var count = cartCount();

    // ── build bottom nav ──
    var nav = document.createElement('nav');
    nav.id = 'mb-bottom-nav';
    nav.setAttribute('aria-label', 'Asosiy navigatsiya');
    nav.innerHTML = NAV_ITEMS.map(function (item) {
      var isActive = active === item.id;
      var badge = (item.cart && count > 0)
        ? '<em class="mb-nav-badge">' + (count > 99 ? '99+' : count) + '</em>'
        : '';
      return '<a href="' + item.href + '" class="mb-nav-item' + (isActive ? ' mb-nav-item--active' : '') + '"'
        + (item.more ? ' id="mb-more-btn" role="button" aria-expanded="false" aria-haspopup="true"' : '')
        + '>'
        + '<span class="mb-nav-icon"><i class="fa ' + item.icon + '"></i>' + badge + '</span>'
        + '<span class="mb-nav-label">' + item.label + '</span>'
        + '</a>';
    }).join('');
    document.body.appendChild(nav);

    // ── build "Ko'proq" drawer ──
    var drawer = document.createElement('div');
    drawer.id = 'mb-more-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.innerHTML = '<div class="mb-more-inner">'
      + '<div class="mb-more-handle"></div>'
      + '<ul class="mb-more-list">'
      + MORE_ITEMS.map(function (item) {
          var isSecondaryActive = currentPage() === item.href.toLowerCase();
          return '<li><a href="' + item.href + '" class="mb-more-link' + (isSecondaryActive ? ' mb-more-link--active' : '') + '">'
            + '<span class="mb-more-icon"><i class="fa ' + item.icon + '"></i></span>'
            + '<span>' + item.label + '</span>'
            + '</a></li>';
        }).join('')
      + '</ul>'
      + '</div>';
    document.body.appendChild(drawer);

    // ── overlay ──
    var overlay = document.createElement('div');
    overlay.id = 'mb-more-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);

    // ── toggle logic ──
    var moreBtn = document.getElementById('mb-more-btn');
    function openMore() {
      drawer.classList.add('mb-more-drawer--open');
      overlay.classList.add('mb-overlay--visible');
      moreBtn.setAttribute('aria-expanded', 'true');
      drawer.setAttribute('aria-hidden', 'false');
    }
    function closeMore() {
      drawer.classList.remove('mb-more-drawer--open');
      overlay.classList.remove('mb-overlay--visible');
      moreBtn.setAttribute('aria-expanded', 'false');
      drawer.setAttribute('aria-hidden', 'true');
    }

    if (moreBtn) {
      moreBtn.addEventListener('click', function (e) {
        e.preventDefault();
        drawer.classList.contains('mb-more-drawer--open') ? closeMore() : openMore();
      });
    }
    overlay.addEventListener('click', closeMore);

    // close drawer on any secondary link tap
    drawer.querySelectorAll('.mb-more-link').forEach(function (link) {
      link.addEventListener('click', closeMore);
    });

    // ── update cart badge live ──
    function refreshBadge() {
      var c = cartCount();
      var badgeEl = nav.querySelector('.mb-nav-badge');
      if (!badgeEl) {
        var cartItem = nav.querySelector('[href="shop-cart.html"] .mb-nav-icon');
        if (c > 0 && cartItem) {
          var em = document.createElement('em');
          em.className = 'mb-nav-badge';
          em.textContent = c > 99 ? '99+' : c;
          cartItem.appendChild(em);
        }
      } else {
        if (c > 0) { badgeEl.textContent = c > 99 ? '99+' : c; }
        else { badgeEl.remove(); }
      }
    }
    window.addEventListener('storage', refreshBadge);
    document.addEventListener('mb:cart-updated', refreshBadge);
  }

  function hideDesktopNavOnMobile() {
    if (window.innerWidth > BREAKPOINT) return;
    var nav = document.querySelector('.market-nav');
    if (nav) nav.style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildNav();
    hideDesktopNavOnMobile();
  });

  // re-check on resize (orientation change)
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var existing = document.getElementById('mb-bottom-nav');
      if (window.innerWidth > BREAKPOINT) {
        // on desktop: remove bottom nav, show header nav
        if (existing) existing.remove();
        var drawerEl = document.getElementById('mb-more-drawer');
        var overlayEl = document.getElementById('mb-more-overlay');
        if (drawerEl) drawerEl.remove();
        if (overlayEl) overlayEl.remove();
        var headerNav = document.querySelector('.market-nav');
        if (headerNav) headerNav.style.display = '';
      } else {
        // on mobile: hide header nav, ensure bottom nav exists
        var headerNav = document.querySelector('.market-nav');
        if (headerNav) headerNav.style.display = 'none';
        if (!existing) buildNav();
      }
    }, 120);
  });
})();

/* ─── Sale Market — sm-header drawer + sticky scroll ─────────────────────── */
(function () {
  function initSmHeader() {
    var header = document.getElementById('sm-header');
    var hamburger = document.getElementById('sm-hamburger');
    var drawer = document.getElementById('sm-drawer');
    var backdrop = document.getElementById('sm-drawer-backdrop');

    if (hamburger && drawer) {
      function openDrawer() {
        drawer.classList.add('sm-drawer--open');
        drawer.setAttribute('aria-hidden', 'false');
        hamburger.setAttribute('aria-expanded', 'true');
      }
      function closeDrawer() {
        drawer.classList.remove('sm-drawer--open');
        drawer.setAttribute('aria-hidden', 'true');
        hamburger.setAttribute('aria-expanded', 'false');
      }
      hamburger.addEventListener('click', function () {
        drawer.classList.contains('sm-drawer--open') ? closeDrawer() : openDrawer();
      });
      if (backdrop) backdrop.addEventListener('click', closeDrawer);
      drawer.querySelectorAll('.sm-drawer__link').forEach(function (link) {
        link.addEventListener('click', closeDrawer);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeDrawer();
      });
    }

    if (header) {
      var onScroll = function () {
        header.classList.toggle('sm-header--scrolled', window.scrollY > 10);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSmHeader);
  } else {
    initSmHeader();
  }
})();
