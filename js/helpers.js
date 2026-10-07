window.MBHelpers = {
  _productsCache: null,
  _productsPromise: null,
  normalizeCategory(value) {
    const raw = String(value || "")
      .toLowerCase()
      .replace(/[’`']/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const map = {
      futbolkalar: "Futbolkalar",
      aksesuarlar: "Aksesuarlar",
      "ustki kiyimlar": "Ustki kiyimlar",
      shimlar: "Shimlar",
      "oyoq kiyimlar": "Oyoq kiyimlar",
      "bosh kiyimlar": "Bosh kiyimlar",
      mebel: "Mebel",
      furniture: "Mebel",
      "мебель": "Mebel",
    };

    return map[raw] || (value || "");
  },
  toList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      const raw = value.trim();
      if (!raw) return [];

      let splitter = /,\s*/;
      if (!raw.includes(",")) {
        splitter = /\s+va\s+/i;
      }
      if (!raw.includes(",") && !/\s+va\s+/i.test(raw)) {
        splitter = /\s+/;
      }

      const tokens = raw
        .split(splitter)
        .map((item) => item.trim())
        .filter(Boolean);

      const expanded = [];
      tokens.forEach((token) => {
        const range = token.match(/^(\d+)\s*[\-\u2010-\u2015\u2212]\s*(\d+)$/);
        if (range) {
          const start = Number(range[1]);
          const end = Number(range[2]);
          if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 30) {
            for (let n = start; n <= end; n += 1) expanded.push(String(n));
            return;
          }
        }

        const uzRange = token.match(/^(\d+)\s*dan\s*(\d+)\s*gacha$/i);
        if (uzRange) {
          const start = Number(uzRange[1]);
          const end = Number(uzRange[2]);
          if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 30) {
            for (let n = start; n <= end; n += 1) expanded.push(String(n));
            return;
          }
        }

        expanded.push(token);
      });

      return [...new Set(expanded)];
    }
    return [];
  },
  isGithubPages() {
    return /\.github\.io$/i.test(window.location.hostname);
  },
  apiUrl(path) {
    const rawPath = String(path || "");
    const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    const base = String(window.MB_API_BASE || "").trim().replace(/\/+$/, "");
    if (!base) return normalizedPath;
    return `${base}${normalizedPath}`;
  },
  async fetchJson(url, options = {}) {
    const res = await fetch(url, { cache: "no-store", ...options });
    if (!res.ok) throw new Error(`Request failed: ${url} (${res.status})`);
    return res.json();
  },
  resolveImagePath(value) {
    const path = String(value || "").trim();
    if (!path) return "img/placeholders/product.svg";
    if (/^(https?:)?\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) return path;
    if (path.startsWith("/")) return path;

    const assetsBase = String(window.MB_ASSET_BASE || window.MB_API_BASE || "").trim().replace(/\/+$/, "");
    if (assetsBase && path.startsWith("uploads/")) return `${assetsBase}/${path}`;
    return path;
  },
  async loadProducts(options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    if (!forceRefresh && Array.isArray(this._productsCache)) return this._productsCache;
    if (!forceRefresh && this._productsPromise) return this._productsPromise;

    const loadTask = (async () => {
      const sources = [];
      const apiProductsUrl = this.apiUrl("/api/products");

      if (window.MB_API_BASE || !this.isGithubPages()) {
        sources.push(apiProductsUrl);
      } else {
        sources.push(apiProductsUrl, "data/products.json");
      }

      if (!sources.includes("data/products.json")) {
        sources.push("data/products.json");
      }

      for (const url of sources) {
        try {
          const data = await this.fetchJson(url);
          const list = (Array.isArray(data) ? data : []).map((product) => this.normalizeProduct(product));
          this._productsCache = list;
          return list;
        } catch (error) {}
      }

      this._productsCache = [];
      return [];
    })();

    this._productsPromise = loadTask.finally(() => {
      this._productsPromise = null;
    });
    return this._productsPromise;
  },
  async loadProductById(productId) {
    const id = String(productId || "").trim();
    if (!id) return null;

    const apiProductUrl = this.apiUrl(`/api/products/${encodeURIComponent(id)}`);
    try {
      const item = await this.fetchJson(apiProductUrl);
      if (item && typeof item === "object") return this.normalizeProduct(item);
    } catch (error) {}

    const list = await this.loadProducts();
    return list.find((item) => String(item.id) === id) || null;
  },
  normalizeProduct(product) {
    const images = this.toList(product.images).map((img) => this.resolveImagePath(img));
    if (product.image) images.unshift(this.resolveImagePath(product.image));
    const uniqueImages = [...new Set(images.filter(Boolean))];

    return {
      ...product,
      category: this.normalizeCategory(product.category),
      image: uniqueImages[0] || "img/placeholders/product.svg",
      images: uniqueImages.length ? uniqueImages : ["img/placeholders/product.svg"],
      description: product.description || product.desc || "",
      sizes: this.toList(product.sizes),
      colors: this.toList(product.colors),
      stock: Math.max(1, Number(product.stock ?? 999) || 999),
      label: product.label || product.badge || "",
    };
  },
  currency(value) {
    const num = Number(value || 0);
    return num.toLocaleString("uz-UZ") + " so'm";
  },
  productCard(product, options = {}) {
    const normalized = this.normalizeProduct(product);
    const showDescription = options.showDescription !== false;
    const image = normalized.images[0];
    const stock = Math.max(1, Number(normalized.stock ?? 999) || 999);
    const inStock = true;
    const oldValue = Number(normalized.oldPrice || 0);
    const priceValue = Number(normalized.price || 0);
    const discount = oldValue > priceValue && priceValue > 0
      ? Math.round((1 - priceValue / oldValue) * 100)
      : 0;
    const rawLabel = String(normalized.label || "").trim();
    const badges = [];
    if (rawLabel) {
      const newLike = /(^|\s)(yangi|new)(\s|$)/i.test(rawLabel);
      badges.push(`<span class="sm-card-badge ${newLike ? "sm-card-badge--new" : "sm-card-badge--info"}">${rawLabel}</span>`);
    }
    if (discount > 0) {
      badges.push(`<span class="sm-card-badge sm-card-badge--discount">-${discount}%</span>`);
    }
    const labelHtml = badges.length ? `<div class="sm-card-badges">${badges.join("")}</div>` : "";
    const oldPrice =
      oldValue > priceValue && priceValue > 0 ? `<span class="product__oldprice">${this.currency(oldValue)}</span>` : "";
    const descriptionHtml = showDescription ? `<p>${normalized.description}</p>` : "";
    const action = `<a class="link-btn js-add-card" href="#" data-id="${normalized.id}">Savatga</a>`;

    return `
      <div class="col-6 col-sm-6 col-md-4 col-lg-3">
        <div class="product__item ${inStock ? "" : "product__item--soldout"}">
          <a href="product-details.html?id=${normalized.id}" class="product__item__pic" style="background-image:url('${image}')">
            ${labelHtml}
          </a>
          <div class="product__item__text">
            <h6><a href="product-details.html?id=${normalized.id}">${normalized.name || "Mahsulot"}</a></h6>
            ${descriptionHtml}
            <div class="product__price">${this.currency(normalized.price)} ${oldPrice}</div>
            <div class="product__links">
              ${action}
            </div>
          </div>
        </div>
      </div>`;
  },
  emptyState(message) {
    return `<div class="col-12"><div class="empty-state"><img src="img/placeholders/product.svg" alt="placeholder"><h5>Hozircha mahsulot yo'q</h5><p>${message}</p></div></div>`;
  },
};
