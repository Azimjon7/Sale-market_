This folder is filled automatically with local BUYO product gallery images.

Automatic paths:
- npm install -> postinstall -> scripts/cache-buyo-gallery-images.js
- npm run cache:images -> manual refresh
- npm start -> best-effort retry only for products not already cached

Each BUYO product caches up to 3 images when the source product page contains them.
If fewer images exist, the available images are kept.
Once a slot such as <product-id>-1.webp exists, it is reused and is not overwritten by a later source URL change.
