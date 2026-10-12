(function (root) {
  // Shared by the storefront and server. Array entries are complete variant names.
  function options(value, type) {
    if (Array.isArray(value)) return [...new Set(value.map(String).map(v => v.trim()).filter(Boolean))];
    const entries = String(value || '').split(',').map(v => v.trim()).filter(Boolean);
    if (type !== 'size') return [...new Set(entries)];
    const sizes = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
    return [...new Set(entries.flatMap(entry => {
      const range = entry.match(/^(\d+)\s*[-\u2010-\u2015\u2212]\s*(\d+)$/);
      if (range) {
        const start = Number(range[1]), end = Number(range[2]);
        if (end >= start && end - start <= 30) return Array.from({ length: end - start + 1 }, (_, i) => String(start + i));
      }
      const letters = entry.toUpperCase().match(/^(XS|S|M|L|XL|[2-5]XL)\s*-\s*(XS|S|M|L|XL|[2-5]XL)$/);
      if (letters && sizes.indexOf(letters[2]) >= sizes.indexOf(letters[1])) return sizes.slice(sizes.indexOf(letters[1]), sizes.indexOf(letters[2]) + 1);
      return [entry];
    }))];
  }
  function stock(product) {
    const value = product.stock;
    return value == null || value === '' ? 999 : Math.max(0, Math.floor(Number(value) || 0));
  }
  function additionError(product, qty, cart) {
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return 'Miqdor 1 dan 999 gacha butun son bo‘lishi kerak.';
    const existing = cart.filter(item => String(item.productId) === String(product.id)).reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const mustCheckStock = product.inventoryManaged === true || product._inventoryMode !== 'made-to-order';
    if (mustCheckStock && existing + qty > stock(product)) return "Omborda buncha mahsulot yo'q.";
    return '';
  }
  const rules = { options, stock, additionError };
  if (typeof module !== 'undefined' && module.exports) module.exports = rules;
  else root.MBProductRules = rules;
})(typeof window === 'undefined' ? globalThis : window);
