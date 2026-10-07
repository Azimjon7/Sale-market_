/**
 * Sale Market — Telegram Order Notifications
 * Fault-isolated: missing config or API failures never crash the checkout.
 */

/**
 * Format a price as "230,000 UZS".
 * @param {number|string} value
 * @returns {string}
 */
function formatPrice(value) {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString("en-US").replace(/,/g, " ") + " UZS";
}

/**
 * Build the Telegram notification message for a new order.
 * @param {Object} order
 * @returns {string}
 */
function buildMessage(order) {
  // ── Items list ─────────────────────────────────────────────────────────────
  const items = (Array.isArray(order.items) ? order.items : [])
    .filter((item) => item && (item.productId || item.name))
    .map((item) => {
      const name = item.name || "Mahsulot";
      const qty = Math.max(1, Number(item.qty || 1));
      const price = formatPrice(item.price || 0);
      return `  • ${name} × ${qty} — ${price}`;
    })
    .join("\n");

  // ── Header ─────────────────────────────────────────────────────────────────
  const lines = [
    "🛒 New Order — Sale Market",
    "",
    `📦 Order ID: #${order.id || "—"}`,
    `👤 Customer: ${order.name || "—"}`,
    `📞 Phone: ${order.phone || "—"}`,
    `📍 Address: ${order.address || "—"}`,
  ];

  // Optional comment / note
  const comment = order.note || order.comment;
  if (comment && comment.trim()) {
    lines.push(`💬 Comment: ${comment.trim()}`);
  }

  // ── Items ──────────────────────────────────────────────────────────────────
  lines.push("");
  lines.push("🧾 Items:");
  lines.push(items || "  (no items)");

  // ── Financial summary ──────────────────────────────────────────────────────
  lines.push("");

  const subtotal = Number(order.subtotal || order.total || 0);
  const discount = Number(order.discountAmount || order.discount || 0);
  const total = Number(order.total || 0);

  if (order.promoCode) {
    const discountPct =
      subtotal > 0 ? Math.round((discount / subtotal) * 100) : 0;
    lines.push(
      `🏷️ Promocode: ${order.promoCode}${discountPct > 0 ? ` (-${discountPct}%)` : ""}`
    );
  }

  lines.push(`💰 Subtotal: ${formatPrice(subtotal)}`);

  if (discount > 0) {
    lines.push(`🎁 Discount: -${formatPrice(discount)}`);
  }

  lines.push(`✅ Total: ${formatPrice(total)}`);

  // ── Payment type ───────────────────────────────────────────────────────────
  const paymentLabel =
    order.paymentType === "karta" ? "Card" : "Cash (on delivery)";
  lines.push(`💳 Payment: ${paymentLabel}`);

  return lines.join("\n");
}

/**
 * Send an order notification to a Telegram chat.
 *
 * Rules:
 *   - Silent no-op when TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.
 *   - Aborts after 5 seconds.
 *   - Never throws — errors are logged but never propagate to callers.
 *
 * @param {Object} order  The saved order object.
 * @returns {Promise<void>}
 */
async function sendOrderNotification(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // Missing env → silent no-op (warned at startup in server.js)
  if (!token || !chatId) {
    return;
  }

  // Node < 18 doesn't have global fetch
  if (typeof fetch !== "function") {
    console.warn(
      "[telegram] global fetch is not available (Node < 18). Skipping order notification."
    );
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
    console.warn(
      "[telegram] Notification timed out (5s) for order",
      order && order.id
    );
  }, 5000);

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: buildMessage(order),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[telegram] API error ${res.status}: ${detail.slice(0, 200)}`
      );
    }
  } catch (err) {
    if (err.name === "AbortError") {
      return; // timeout already logged above
    }
    console.error("[telegram] sendOrderNotification failed:", err.message);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendOrderNotification, buildMessage, formatPrice };
