const path = require('path');
const { cacheBuyoGalleryImages } = require('../utils/cacheBuyoGalleryImages');

cacheBuyoGalleryImages({ projectRoot: path.join(__dirname, '..'), maxImages: 3 })
  .then((result) => {
    console.log('\nBUYO gallery cache finished:', result);
    console.log('Products with fewer than 3 source images are intentionally left with the images that were available.');
  })
  .catch((err) => {
    // Do not break npm install / Render deployment if BUYO is temporarily unavailable.
    console.warn('\nBUYO gallery cache could not finish:', err.message || err);
  });
