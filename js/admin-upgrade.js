(function () {
  "use strict";

  const SETTINGS_KEY = "mujskoy_admin_settings";

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
      return;
    }
    callback();
  }

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  window.loadAdminSettings = function loadAdminSettings() {
    const settings = {
      storeName: "Sale Market",
      phone: "+998 90 123 45 67",
      deliveryPrice: "30000",
      minOrder: "100000",
      ...readSettings(),
    };
    const fields = {
      settingStoreName: settings.storeName,
      settingPhone: settings.phone,
      settingDeliveryPrice: settings.deliveryPrice,
      settingMinOrder: settings.minOrder,
    };
    Object.entries(fields).forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (input) input.value = value;
    });
  };

  window.saveAdminSettings = function saveAdminSettings() {
    const settings = {
      storeName: document.getElementById("settingStoreName")?.value.trim() || "Sale Market",
      phone: document.getElementById("settingPhone")?.value.trim() || "",
      deliveryPrice: document.getElementById("settingDeliveryPrice")?.value.trim() || "0",
      minOrder: document.getElementById("settingMinOrder")?.value.trim() || "0",
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    const message = document.getElementById("settingsMessage");
    if (message) message.innerHTML = '<div class="empty">Sozlamalar saqlandi.</div>';
    if (typeof window.showNotice === "function") window.showNotice("Sozlamalar saqlandi");
  };

  function filterVisibleOrders(query) {
    document.querySelectorAll("#ordersList .order-item").forEach((item) => {
      item.style.display = (!query || item.textContent.toLowerCase().includes(query)) ? "" : "none";
    });
  }

  function bindGlobalSearch() {
    const input = document.getElementById("adminGlobalSearch");
    if (!input) return;
    input.addEventListener("input", function () {
      const query = input.value.trim().toLowerCase();
      const productSearch = document.getElementById("productSearch");
      if (productSearch) productSearch.value = query;
      if (!document.getElementById("sectionProducts")?.classList.contains("hidden") && typeof window.renderProducts === "function") {
        window.renderProducts();
      }
      if (!document.getElementById("sectionOrders")?.classList.contains("hidden")) {
        filterVisibleOrders(query);
      }
    });
    input.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (typeof window.showSection === "function") {
        window.showSection("products");
        const productSearch = document.getElementById("productSearch");
        if (productSearch) productSearch.value = input.value.trim().toLowerCase();
        if (typeof window.renderProducts === "function") window.renderProducts();
      }
    });
  }

  function enhanceSectionSwitching() {
    if (typeof window.showSection !== "function" || window.showSection.__adminEnhanced) return;
    const originalShowSection = window.showSection;
    window.showSection = function enhancedShowSection(section) {
      originalShowSection(section);
      // Close mobile sidebar when switching sections
      closeMobileSidebar();
      const activePanel = document.querySelector("main .panel:not(.hidden)");
      if (activePanel) {
        activePanel.classList.remove("admin-section-active");
        window.requestAnimationFrame(() => activePanel.classList.add("admin-section-active"));
      }
    };
    window.showSection.__adminEnhanced = true;
  }

  /* ─── MOBILE SIDEBAR OVERLAY TOGGLE ─────────────────────────────────────── */
  function isMobileWidth() {
    return window.innerWidth <= 900;
  }

  window.closeMobileSidebar = function closeMobileSidebar() {
    var sidebar = document.querySelector(".sidebar");
    var overlay = document.getElementById("adminSidebarOverlay");
    if (sidebar) sidebar.classList.remove("sidebar--open");
    if (overlay) overlay.classList.add("hidden");
    document.body.style.overflow = "";
  };

  function openMobileSidebar() {
    var sidebar = document.querySelector(".sidebar");
    var overlay = document.getElementById("adminSidebarOverlay");
    if (sidebar) sidebar.classList.add("sidebar--open");
    if (overlay) overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function initMobileSidebar() {
    var brand = document.getElementById("adminMobileBrand");
    if (!brand) return;

    brand.addEventListener("click", function (e) {
      if (!isMobileWidth()) return;
      e.stopPropagation();
      var sidebar = document.querySelector(".sidebar");
      if (sidebar && sidebar.classList.contains("sidebar--open")) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    });

    // Close on menu button click
    document.querySelectorAll(".menu button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (isMobileWidth()) closeMobileSidebar();
      });
    });

    // On resize back to desktop — clean up
    window.addEventListener("resize", function () {
      if (!isMobileWidth()) {
        closeMobileSidebar();
        document.body.style.overflow = "";
        // Re-render orders for correct layout
        var ordersList = document.getElementById("ordersList");
        if (ordersList && ordersList.children.length > 0 && typeof window.renderOrders === "function") {
          window.renderOrders();
        }
      }
    });
  }

  /* ─── STAT DETAIL MODAL ──────────────────────────────────────────────────── */

  // Helper: escape HTML
  function esc(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Helper: format money
  function fmt(val) {
    return String(Math.round(Number(val || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
  }

  // Stat config map
  var STAT_CONFIG = {
    products: {
      title: "Jami mahsulotlar",
      icon: "□",
      iconBg: "linear-gradient(135deg, #ffd400, #fff3a2)",
      getVal: function () { return document.getElementById("statProducts")?.textContent || "0"; },
      lbl: "Faol mahsulot",
      section: "products",
      sectionLabel: "Mahsulotlarga o'tish →",
      buildRows: function (products) {
        if (!products || !products.length) return null;
        return products.slice(0, 6).map(function (p) {
          return '<div class="stat-detail-row" onclick="showSection(\'products\')" style="cursor:pointer">'
            + '<strong>' + esc(p.name || "Mahsulot") + '</strong>'
            + '<span>' + esc(p.category || "-") + '</span>'
            + '<span>' + fmt(p.price) + '</span>'
            + '</div>';
        }).join("");
      },
    },
    orders: {
      title: "Jami buyurtmalar",
      icon: "☰",
      iconBg: "linear-gradient(135deg, #dbeafe, #93c5fd)",
      getVal: function () { return document.getElementById("statOrders")?.textContent || "0"; },
      lbl: "Barcha buyurtmalar",
      section: "orders",
      sectionLabel: "Barcha buyurtmalarga o'tish →",
      buildRows: function (products, orders) {
        if (!orders || !orders.length) return null;
        return orders.slice(0, 6).map(function (o) {
          var statusTxt = o.status || "Qabul qilindi";
          return '<div class="stat-detail-row" onclick="(function(){var o=cachedOrders.find(function(x){return x.id===\'' + esc(o.id) + '\'});if(o)openOrderDetailModal(o)})()">'
            + '<strong>' + esc(o.name || "Mijoz") + '</strong>'
            + '<span>' + esc(statusTxt) + '</span>'
            + '<span>' + fmt(typeof getOrderTotal === "function" ? getOrderTotal(o) : (o.total || 0)) + '</span>'
            + '</div>';
        }).join("");
      },
    },
    today: {
      title: "Bugungi buyurtmalar",
      icon: "◷",
      iconBg: "linear-gradient(135deg, #fef3c7, #fcd34d)",
      getVal: function () { return document.getElementById("statTodayOrders")?.textContent || "0"; },
      lbl: "Bugun kelgan buyurtmalar",
      section: "orders",
      sectionLabel: "Barcha buyurtmalarga o'tish →",
      buildRows: function (products, orders) {
        if (!orders || !orders.length) return null;
        var today = orders.filter(function (o) {
          if (typeof isToday === "function") return isToday(o.createdAt);
          var d = new Date(o.createdAt || "");
          if (isNaN(d.getTime())) return false;
          var now = new Date();
          return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
        });
        if (!today.length) return null;
        return today.map(function (o) {
          return '<div class="stat-detail-row" onclick="(function(){var o=cachedOrders.find(function(x){return x.id===\'' + esc(o.id) + '\'});if(o)openOrderDetailModal(o)})()">'
            + '<strong>' + esc(o.name || "Mijoz") + '</strong>'
            + '<span>' + esc(o.status || "-") + '</span>'
            + '<span>' + fmt(typeof getOrderTotal === "function" ? getOrderTotal(o) : (o.total || 0)) + '</span>'
            + '</div>';
        }).join("");
      },
    },
    revenue: {
      title: "Umumiy tushum",
      icon: "S",
      iconBg: "linear-gradient(135deg, #dcfce7, #86efac)",
      getVal: function () { return document.getElementById("statRevenue")?.textContent || "0"; },
      lbl: "Bekor qilinganlarsiz",
      section: "orders",
      sectionLabel: "Buyurtmalarga o'tish →",
      buildRows: function (products, orders) {
        if (!orders || !orders.length) return null;
        var active = orders.filter(function (o) {
          var s = typeof normalizeStatus === "function" ? normalizeStatus(o.status) : (o.status || "");
          return s !== "Bekor qilindi";
        });
        var total = active.reduce(function (sum, o) {
          return sum + (typeof getOrderTotal === "function" ? getOrderTotal(o) : Number(o.total || 0));
        }, 0);
        // Show last 5 active orders
        return '<div class="stat-detail-hero" style="margin:0 0 12px">'
          + '<div class="stat-detail-icon" style="background:linear-gradient(135deg,#dcfce7,#86efac)">S</div>'
          + '<div><div class="stat-detail-val">' + fmt(total) + '</div>'
          + '<div class="stat-detail-lbl">Aktiv buyurtmalar summasi</div></div>'
          + '</div>'
          + active.slice(0, 5).map(function (o) {
            return '<div class="stat-detail-row">'
              + '<strong>' + esc(o.name || "Mijoz") + '</strong>'
              + '<span>' + esc(o.status || "-") + '</span>'
              + '<span>' + fmt(typeof getOrderTotal === "function" ? getOrderTotal(o) : (o.total || 0)) + '</span>'
              + '</div>';
          }).join("");
      },
    },
    delivered: {
      title: "Yetkazilgan buyurtmalar",
      icon: "✓",
      iconBg: "linear-gradient(135deg, #dcfce7, #86efac)",
      getVal: function () { return document.getElementById("statDeliveredOrders")?.textContent || "0"; },
      lbl: "Muvaffaqiyatli yakunlangan",
      section: "orders",
      sectionLabel: "Barcha buyurtmalarga o'tish →",
      buildRows: function (products, orders) {
        if (!orders || !orders.length) return null;
        var delivered = orders.filter(function (o) {
          var s = typeof normalizeStatus === "function" ? normalizeStatus(o.status) : (o.status || "");
          return s === "Yetkazildi";
        });
        if (!delivered.length) return null;
        return delivered.slice(0, 6).map(function (o) {
          return '<div class="stat-detail-row">'
            + '<strong>' + esc(o.name || "Mijoz") + '</strong>'
            + '<span>' + esc(typeof formatDate === "function" ? formatDate(o.createdAt) : "-") + '</span>'
            + '<span>' + fmt(typeof getOrderTotal === "function" ? getOrderTotal(o) : (o.total || 0)) + '</span>'
            + '</div>';
        }).join("");
      },
    },
    cancelled: {
      title: "Bekor qilingan buyurtmalar",
      icon: "!",
      iconBg: "linear-gradient(135deg, #fee2e2, #fca5a5)",
      getVal: function () { return document.getElementById("statCancelledOrders")?.textContent || "0"; },
      lbl: "Nazorat uchun",
      section: "orders",
      sectionLabel: "Barcha buyurtmalarga o'tish →",
      buildRows: function (products, orders) {
        if (!orders || !orders.length) return null;
        var cancelled = orders.filter(function (o) {
          var s = typeof normalizeStatus === "function" ? normalizeStatus(o.status) : (o.status || "");
          return s === "Bekor qilindi";
        });
        if (!cancelled.length) return null;
        return cancelled.slice(0, 6).map(function (o) {
          return '<div class="stat-detail-row">'
            + '<strong>' + esc(o.name || "Mijoz") + '</strong>'
            + '<span>' + esc(typeof formatDate === "function" ? formatDate(o.createdAt) : "-") + '</span>'
            + '<span>' + fmt(typeof getOrderTotal === "function" ? getOrderTotal(o) : (o.total || 0)) + '</span>'
            + '</div>';
        }).join("");
      },
    },
  };

  window.openStatDetail = function openStatDetail(statKey) {
    var config = STAT_CONFIG[statKey];
    if (!config) return;

    var overlay = document.getElementById("statDetailOverlay");
    var titleEl = document.getElementById("statDetailTitle");
    var content = document.getElementById("statDetailContent");
    if (!overlay || !content) return;

    titleEl.textContent = config.title;

    // Get cached data from main script globals
    var products = (typeof cachedProducts !== "undefined" && Array.isArray(cachedProducts)) ? cachedProducts : [];
    var orders   = (typeof cachedOrders   !== "undefined" && Array.isArray(cachedOrders))   ? cachedOrders   : [];

    var rowsHtml = config.buildRows(products, orders) || '<div class="stat-detail-empty">Ma\'lumot mavjud emas.</div>';

    content.innerHTML =
      '<div class="stat-detail-hero">'
      + '<div class="stat-detail-icon" style="background:' + config.iconBg + '">' + config.icon + '</div>'
      + '<div>'
      + '<div class="stat-detail-val">' + esc(config.getVal()) + '</div>'
      + '<div class="stat-detail-lbl">' + esc(config.lbl) + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="stat-detail-list">' + rowsHtml + '</div>'
      + '<button class="stat-detail-shortcut" onclick="closeStatDetail();showSection(\'' + config.section + '\')">'
      + config.sectionLabel
      + '</button>';

    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  };

  window.closeStatDetail = function closeStatDetail() {
    var overlay = document.getElementById("statDetailOverlay");
    if (overlay) overlay.classList.add("hidden");
    document.body.style.overflow = "";
  };

  // Keyboard: Escape closes any open modal
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      window.closeStatDetail();
      if (typeof window.closeOrderDetailModal === "function") window.closeOrderDetailModal();
      closeMobileSidebar();
    }
  });

  /* ─── INIT ───────────────────────────────────────────────────────────────── */
  ready(function () {
    bindGlobalSearch();
    enhanceSectionSwitching();
    initMobileSidebar();
    window.loadAdminSettings();
  });
})();
