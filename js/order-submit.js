(function (root) {
  // The cart may be cleared only after the server acknowledges a saved order.
  async function submitOrder(requestOptions, fetcher = root.fetch.bind(root)) {
    let response;
    try { response = await fetcher(root.MBHelpers ? root.MBHelpers.apiUrl('/api/orders') : '/api/orders', requestOptions); }
    catch { throw new Error("Server bilan aloqa uzildi. Korzinangiz saqlandi; buyurtma holatini tekshiring."); }
    let data;
    try { data = await response.json(); }
    catch { throw new Error("Server javobi tushunarsiz. Korzinangiz saqlandi."); }
    if (!response.ok || !data || data.success !== true || !data.order || !data.order.id) {
      const details = data && Array.isArray(data.errors) ? data.errors.map(e => e.message).filter(Boolean).join(' ') : '';
      throw new Error(details || (data && (data.message || data.error)) || "Buyurtma tasdiqlanmadi. Korzinangiz saqlandi.");
    }
    return data.order;
  }
  function submissionToken(payload) {
    const fingerprint = JSON.stringify(payload);
    try {
      const previous = JSON.parse(root.sessionStorage.getItem('dodola_submission') || 'null');
      if (previous && previous.fingerprint === fingerprint) return previous.token;
    } catch {}
    const token = root.crypto.randomUUID();
    try { root.sessionStorage.setItem('dodola_submission', JSON.stringify({ fingerprint, token })); } catch {}
    return token;
  }
  function forgetSubmissionToken() {
    try { root.sessionStorage.removeItem('dodola_submission'); } catch {}
  }
  root.MBOrderSubmit = { submitOrder, submissionToken, forgetSubmissionToken };
  if (typeof module !== 'undefined' && module.exports) module.exports = { submitOrder };
})(typeof window === 'undefined' ? globalThis : window);

