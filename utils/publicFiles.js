const fs = require('fs');
const path = require('path');

// Only browser entry points and assets belong on the public web server.
const pages = new Set(['index.html', 'admin.html', 'shop.html', 'shop-cart.html',
  'checkout.html', 'success.html', 'track-order.html', 'product-details.html',
  'contact.html', 'blog.html', 'blog-details.html', 'main.html', 'auth.html',
  'account.html', 'reset-password.html']);
const scripts = new Set(['admin-upgrade.js', 'admin.js', 'bootstrap.min.js',
  'cart-page.js', 'checkout-page.js', 'helpers.js', 'hero-preview.js', 'home-luxe.js',
  'index-products.js', 'jquery-3.3.1.min.js', 'jquery-ui.min.js',
  'jquery.countdown.min.js', 'jquery.magnific-popup.min.js', 'jquery.nicescroll.min.js',
  'jquery.slicknav.js', 'main.js', 'marketplace-upgrade.js', 'mixitup.min.js',
  'mobile-catalog-filter.js', 'owl.carousel.min.js', 'panel-manager.js',
  'product-page.js', 'search-engine.js', 'shared-header-init.js', 'shop-products.js',
  'shop-toolbar.js', 'store.js', 'order-submit.js', 'product-rules.js', 'order-labels.js',
  'auth-page.js', 'account-page.js', 'header-account.js']);
const imageExtension = /\.(?:png|jpe?g|webp|gif|avif|svg|ico)$/i;

function safeFile(root, relative) {
  if (!relative || relative.includes('\\') || relative.split('/').some(p => !p || p.startsWith('.'))) return null;
  let current = root;
  try {
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    }
    return fs.statSync(current).isFile() ? current : null;
  } catch { return null; }
}

function publicFiles({ root, uploadsDir, getProducts, objectStorage }) {
  return async (req, res, next) => {
    try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let relative;
    try { relative = decodeURIComponent(req.path).replace(/^\//, ''); }
    catch { return res.sendStatus(404); }
    if (!relative) relative = 'index.html';
    let file = null;
    const isStaticImage = relative.startsWith('img/') && imageExtension.test(relative);
    if (pages.has(relative) ||
        (relative.startsWith('js/') && scripts.has(relative.slice(3))) ||
        (/^css\/[\w-]+(?:\.min)?\.css$/.test(relative)) ||
        (/^fonts\//.test(relative) && /\.(?:woff2?|ttf|eot|otf|svg)$/i.test(relative)) ||
        isStaticImage) {
      if (isStaticImage && objectStorage) {
        const delivery = objectStorage.publicDelivery(relative);
        if (delivery && delivery.redirect) return res.redirect(302, delivery.redirect);
      }
      file = safeFile(root, relative);
    } else if (relative.startsWith('uploads/') && imageExtension.test(relative)) {
      // Payment receipts share the upload directory, but are never public assets.
      const products = await Promise.resolve(getProducts());
      const referenced = products.some(p => [p.image, ...(Array.isArray(p.images) ? p.images : [])]
        .some(image => typeof image === 'string' && image.replace(/^\//, '') === relative));
      if (referenced && objectStorage) {
        const delivery = objectStorage.publicDelivery(relative);
        if (delivery && delivery.redirect) return res.redirect(302, delivery.redirect);
      }
      if (referenced) file = safeFile(uploadsDir, relative.slice(8));
    }
    if (!file) return next();
    res.sendFile(path.basename(file), { root: path.dirname(file), dotfiles: 'deny', headers: { 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) { next(error); }
  };
}

module.exports = { publicFiles, safeFile };
