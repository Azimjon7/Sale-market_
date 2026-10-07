(function () {
  const CART_KEY = 'mujskoy_cart';
  const ORDERS_KEY = 'mujskoy_orders';

  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (e) { return []; }
  }

  function getLocalOrders() {
    try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); } catch (e) { return []; }
  }

  function normalizePhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.startsWith("998") && digits.length > 9 ? digits.slice(-9) : digits;
  }

  function productSnapshot(product) {
    if (!product || typeof product !== "object") return null;
    const images = Array.isArray(product.images) ? product.images : [];
    return {
      id: String(product.id || product.productId || ""),
      name: product.name || "Mahsulot",
      price: Number(product.price || 0),
      oldPrice: Number(product.oldPrice || 0),
      image: product.image || images[0] || "img/placeholders/product.svg",
      images: images.length ? images : [product.image || "img/placeholders/product.svg"],
      category: product.category || "",
      stock: Number(product.stock ?? 999),
    };
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCounters();
  }
  function addToCart(item) {
    const cart = getCart();
    const snapshot = productSnapshot(item.product);
    const normalizedItem = {
      ...item,
      productId: String(item.productId),
      qty: Math.max(1, Number(item.qty) || 1),
      size: item.size || "",
      color: item.color || "",
      product: snapshot || item.product || null,
    };
    const found = cart.find(x =>
      String(x.productId) === normalizedItem.productId &&
      String(x.size || "") === normalizedItem.size &&
      String(x.color || "") === normalizedItem.color
    );
    if (found) {
      found.qty = Math.max(1, Number(found.qty) || 1) + normalizedItem.qty;
      if (normalizedItem.product) found.product = normalizedItem.product;
    }
    else cart.push(normalizedItem);
    saveCart(cart);
  }
  function removeFromCart(index) {
    const cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
  }
  function updateQty(index, qty) {
    const cart = getCart();
    if (!cart[index]) return;
    cart[index].qty = Math.max(1, Number(qty) || 1);
    saveCart(cart);
  }
  function clearCart() {
    saveCart([]);
  }

  function saveLocalOrder(order) {
    const orders = getLocalOrders();
    const item = {
      ...order,
      id: order.id || `ord_${Date.now()}`,
      status: order.status || "new",
      createdAt: order.createdAt || new Date().toISOString(),
    };
    orders.unshift(item);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
    return item;
  }

  function findLocalOrder(orderId, phone) {
    const normalizedPhone = normalizePhone(phone);
    return getLocalOrders().find((order) => {
      return String(order.id) === String(orderId) && normalizePhone(order.phone) === normalizedPhone;
    }) || null;
  }

  function updateCartCounters() {
    const count = getCart().reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    document.querySelectorAll('.js-cart-count').forEach(el => el.textContent = count);
  }
  window.MBStore = { getCart, saveCart, addToCart, removeFromCart, updateQty, clearCart, getLocalOrders, saveLocalOrder, findLocalOrder, updateCartCounters };
  document.addEventListener('DOMContentLoaded', updateCartCounters);
})();
