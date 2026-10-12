(function () {
  'use strict';

  function currentReturnPath() {
    return location.pathname + location.search + location.hash;
  }

  function guestUrl() {
    return '/auth.html?return=' + encodeURIComponent(currentReturnPath());
  }

  function prepareLinks() {
    document.querySelectorAll('a[href="admin.html"],a[href="./admin.html"],a[href="/admin.html"]').forEach(function (link) {
      link.classList.add('js-profile-entry');
      link.href = guestUrl();
      link.setAttribute('aria-label', 'Kirish yoki shaxsiy kabinet');
      var icon = link.querySelector('i');
      link.replaceChildren();
      if (icon) link.appendChild(icon);
      var label = document.createElement('span');
      label.setAttribute('data-profile-label', '');
      label.textContent = 'Kirish';
      link.appendChild(label);
    });
    document.querySelectorAll('.js-profile-entry').forEach(function (link) {
      if (!link.closest('#mb-bottom-nav') && !link.querySelector('[data-profile-label]')) {
        var label = document.createElement('span');
        label.setAttribute('data-profile-label', '');
        label.textContent = 'Kirish';
        link.appendChild(label);
      }
      if (!link.dataset.profileBound) {
        link.dataset.profileBound = 'true';
        link.addEventListener('click', function () {
          if (!link.dataset.authenticated) link.href = guestUrl();
        });
      }
    });
  }

  function updateLinks(data) {
    var authenticated = Boolean(data && data.authenticated);
    var role = data && data.role;
    var destination = authenticated ? (role === 'admin' ? '/admin.html' : '/account.html') : guestUrl();
    var label = authenticated ? (role === 'admin' ? 'Admin' : 'Profil') : 'Kirish';
    document.querySelectorAll('.js-profile-entry').forEach(function (link) {
      link.href = destination;
      link.dataset.authenticated = authenticated ? 'true' : '';
      link.dataset.role = role || '';
      var text = link.closest('#mb-bottom-nav') ? null : link.querySelector('[data-profile-label]');
      if (text) text.textContent = label;
    });
  }

  async function resolveAccountNavigation() {
    prepareLinks();
    var data = { authenticated: false, role: null };
    try {
      var headers = {};
      var adminToken = localStorage.getItem('mb_admin_token');
      if (adminToken) headers.Authorization = 'Bearer ' + adminToken;
      var response = await fetch('/api/auth/session', { headers: headers, credentials: 'same-origin' });
      if (response.ok) data = await response.json();
      else if (adminToken) {
        localStorage.removeItem('mb_admin_token');
        localStorage.removeItem('mb_admin_logged_in');
      }
    } catch (_) {}
    prepareLinks();
    updateLinks(data);
    window.dispatchEvent(new CustomEvent('dodola:account-navigation', { detail: data }));
    return data;
  }

  window.DodolaAccountNavigation = { refresh: resolveAccountNavigation, guestUrl: guestUrl };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resolveAccountNavigation);
  else resolveAccountNavigation();
})();
