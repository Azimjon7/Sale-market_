# Sale Market — Online Store Platform

> A complete, client-ready e-commerce solution built for small businesses in Uzbekistan.  
> Features a product catalog, shopping cart, checkout, and a full admin panel — all in a single Node.js + Vanilla JS app with no database required.

---

## Overview

**Sale Market** is a ready-to-deploy online store for small to medium businesses. It provides everything needed to start selling online: a polished storefront, a secure admin dashboard, order management, Telegram order notifications, and promocode support.

The project is intentionally simple to deploy — no database setup, no build step, no DevOps expertise required. Products, orders, reviews, and promocodes are stored as JSON files on disk.

**Who is it for?**  
Small clothing stores, fashion brands, accessory shops, or any Uzbek small business that needs a professional-looking online store they can manage themselves.

---

## Features

### Customer-facing storefront
- **Product catalog** — filterable by category, searchable, sortable (newest / price / most-reviewed)
- **Product detail page** — image gallery, size & color selection, stock badge, customer reviews
- **Shopping cart** — real-time quantity updates, remove items, promocode application
- **Checkout** — contact form with inline validation, Uzbek phone format (+998XXXXXXXXX), payment type selection, order summary
- **Order success page** — order ID, date, total, track link
- **Order tracking** — look up order status by ID and phone number

### Admin panel (`/admin.html`)
- **Dashboard** — live stats (total products, orders, revenue, today's orders), weekly sales chart, top products/categories, recent orders
- **Product management** — add/edit/delete products with image upload, sizes, colors, stock, category, label
- **Order management** — view all orders, status badges, order details modal, status update (pending → processing → shipped → delivered / cancelled)
- **Promocode management** — create/delete discount codes, view usage
- **Review management** — view all reviews with product/reviewer/rating/comment, delete reviews
- **Category management** — add/edit/delete product categories
- **Settings** — store name, phone, delivery settings (saved to localStorage)

### Security & backend
- JWT authentication (24h expiry) with Bearer token verification
- Admin login rate limiting (5 attempts / 15 minutes per IP)
- `helmet` security headers
- CORS restrictions in production
- 2 MB request body limit
- Atomic JSON writes (temp-file + rename, no partial-write corruption)
- Structured input validation for all API endpoints

### Integrations
- **Telegram notifications** — formatted order message sent to a channel/group when an order is placed
- Missing Telegram config is a graceful no-op — orders never blocked

### Design & UX
- Mobile-first responsive layout (works on phones, tablets, desktops)
- Shared design system (Inter font, CSS variables: navy `#1a1a2e`, crimson `#e94560`)
- Sticky header with mobile hamburger drawer
- Skeleton loading states, empty states, toast notifications
- Accessible: semantic HTML, labels on all inputs, keyboard navigation, ARIA attributes

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Backend | Express.js |
| Authentication | `jsonwebtoken` |
| File uploads | `multer` |
| Security | `helmet`, `express-rate-limit`, `cors` |
| Frontend | Vanilla HTML/CSS/JavaScript |
| CSS framework | Bootstrap 5 (grid only) + custom design system |
| Icons | Font Awesome 4 |
| Fonts | Inter (Google Fonts) |
| Database | JSON files (no setup required) |
| Notifications | Telegram Bot API |

---

## Screenshots

> Add screenshots here — home page, catalog, product detail, cart, checkout, admin dashboard, admin orders.

---

## Quick Start

```bash
# 1. Enter the project directory
cd mujskoy-brend-1-upgrade-v2

# 2. Install dependencies
npm install

# 3. Copy environment file and fill in your values
cp .env.example .env

# 4. Start the server
npm start

# 5. Open in your browser
# Storefront: http://localhost:3000
# Admin panel: http://localhost:3000/admin.html
```

---

## Environment Variables

| Variable | Required | Description | Example |
|---|---|---|---|
| `JWT_SECRET` | ✅ Yes | JWT signing secret (min 32 characters) | `my_long_random_secret_string_here_2025` |
| `ADMIN_USERNAME` | ✅ Yes | Admin panel username | `admin` |
| `ADMIN_PASSWORD` | ✅ Yes | Admin panel password | `SecurePass123` |
| `PORT` | No | Port to listen on (default: 3000) | `3000` |
| `NODE_ENV` | No | `development` or `production` | `production` |
| `TELEGRAM_BOT_TOKEN` | No | Telegram Bot API token | `123456:ABCdef...` |
| `TELEGRAM_CHAT_ID` | No | Chat/channel ID to send notifications | `-1001234567890` |
| `ALLOWED_ORIGIN` | No | CORS origin (production only) | `https://salemarket.uz` |

If `JWT_SECRET` is shorter than 32 characters, the server will **refuse to start** and print a clear error.  
If Telegram vars are missing, notifications are silently disabled — orders still work.

---

## Admin Panel

**URL:** `http://localhost:3000/admin.html`

**Set credentials** in `.env`:
```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
```

**What admin can manage:**
- ➕ Add, edit, and delete products (with image URLs, sizes, colors, stock, pricing)
- 📦 View all orders, see full order details, update order status
- 🎟 Create and delete promotional discount codes
- ⭐ View and delete customer reviews
- 📁 Manage product categories
- 📊 View sales dashboard with weekly chart and top products

---

## Telegram Setup

1. **Create a bot** — message `@BotFather` on Telegram and send `/newbot`
2. **Copy the token** — it looks like `123456789:ABCdefGHI...`
3. **Get your Chat ID:**
   - Add the bot to your channel/group, **or**
   - Send a message to the bot and visit `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Find `"chat":{"id":...}` in the response
4. **Add to `.env`:**
   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
   TELEGRAM_CHAT_ID=-1001234567890
   ```
5. Restart the server. New orders will now send a formatted notification.

**Example notification:**
```
🛒 New Order — Sale Market

📦 Order ID: #ord_1706000400000
👤 Customer: Bobur Toshmatov
📞 Phone: +998712345678
📍 Address: Tashkent, Mirzo Ulugbek 5-kvartal, 22-uy

🧾 Items:
  • AirMax Fire × 1 — 445 000 UZS
  • Trend kepka × 2 — 80 000 UZS

🏷️ Promocode: SALE20 (-20%)
💰 Subtotal: 655 000 UZS
🎁 Discount: -131 000 UZS
✅ Total: 524 000 UZS
💳 Payment: Cash (on delivery)
```

---

## Deployment

### Render (recommended free option)
1. Push your project to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Add all required environment variables in the Render dashboard
6. **Note:** Render's free tier has ephemeral storage — uploaded images and JSON data won't persist across deploys. Use a persistent volume or external storage for production.

### Railway
1. Connect GitHub repo to [railway.app](https://railway.app)
2. Railway auto-detects Node.js and runs `npm start`
3. Set environment variables in the Railway dashboard
4. Same storage caveat as Render — use a volume or switch to a database for persistence.

### VPS (DigitalOcean / Hetzner / etc.)
```bash
# Clone on server
git clone <your-repo> /var/www/salemarket
cd /var/www/salemarket/mujskoy-brend-1-upgrade-v2

# Install and configure
npm install
cp .env.example .env && nano .env

# Run with PM2
npm install -g pm2
pm2 start server.js --name "sale-market"
pm2 save && pm2 startup

# Nginx reverse proxy
# Proxy http://localhost:3000 → your domain
```

---

## Folder Structure

```
mujskoy-brend-1-upgrade-v2/
├── server.js                   # Express entry point (env validation, middleware, routes)
├── package.json
├── .env                        # Environment variables (not committed)
├── .env.example                # Template for environment variables
│
├── middleware/
│   └── verifyAdminToken.js     # JWT Bearer authentication middleware
│
├── utils/
│   ├── jsonStore.js            # Atomic JSON read/write helpers
│   └── telegram.js             # Order notification sender (fault-isolated)
│
├── data/                       # JSON file database
│   ├── products.json
│   ├── orders.json
│   ├── reviews.json
│   ├── promocodes.json
│   └── categories.json
│
├── uploads/                    # Product image uploads
│
├── css/
│   ├── design-system.css       # CSS custom properties (colors, spacing, fonts)
│   ├── components.css          # Reusable UI components
│   ├── marketplace-upgrade.css # Extended shared styles
│   ├── admin-upgrade.css       # Admin panel styles
│   └── ...                     # Bootstrap, FontAwesome, etc.
│
├── js/
│   ├── store.js                # Cart management (localStorage)
│   ├── helpers.js              # Product loading, normalisation, utilities
│   ├── index-products.js       # Home page products with skeleton loading
│   ├── shop-products.js        # Catalog with debounced search + filters
│   └── cart-page.js            # Cart page with promocode support
│
├── index.html                  # Home page (hero, featured products, categories)
├── shop.html                   # Product catalog
├── product-details.html        # Product detail page
├── shop-cart.html              # Shopping cart
├── checkout.html               # Order form + checkout
├── success.html                # Order confirmation
├── track-order.html            # Order tracking by ID + phone
├── contact.html                # Contact page
└── admin.html                  # Admin dashboard (login + all management sections)
```

---

## API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/admin/login` | No | Admin login, returns JWT |
| `GET` | `/api/products` | No | List products (supports `?page`, `?limit`, `?category`, `?search`, `?sort`) |
| `GET` | `/api/products/:id` | No | Get single product |
| `POST` | `/api/products` | ✅ Admin | Create product |
| `PUT` | `/api/products/:id` | ✅ Admin | Update product |
| `DELETE` | `/api/products/:id` | ✅ Admin | Delete product |
| `POST` | `/api/orders` | No | Create order (sends Telegram notification) |
| `GET` | `/api/orders` | ✅ Admin | List all orders |
| `PATCH` | `/api/orders/:id/status` | ✅ Admin | Update order status |
| `DELETE` | `/api/orders/:id` | ✅ Admin | Delete order |
| `GET` | `/api/orders/track` | No | Track order by `?orderId=&phone=` |
| `POST` | `/api/orders/track` | No | Track order (POST body) |
| `GET` | `/api/reviews` | No | List reviews (optional `?productId=`) |
| `POST` | `/api/reviews` | No | Submit a review |
| `DELETE` | `/api/reviews/:id` | ✅ Admin | Delete a review |
| `POST` | `/api/promocodes/apply` | No | Apply promocode, returns discount |
| `GET` | `/api/promocodes` | ✅ Admin | List all promocodes |
| `POST` | `/api/promocodes` | ✅ Admin | Create promocode |
| `DELETE` | `/api/promocodes/:code` | ✅ Admin | Delete promocode |
| `GET` | `/api/categories` | No | List categories |
| `POST` | `/api/categories` | ✅ Admin | Create category |
| `PUT` | `/api/categories/:name` | ✅ Admin | Rename category |
| `DELETE` | `/api/categories/:name` | ✅ Admin | Delete category |
| `GET` | `/api/orders/export` | ✅ Admin | Export orders as Excel file |

**Authentication:** Include `Authorization: Bearer <token>` header for admin routes.  
**Validation errors** return `{ "error": "Validation failed", "details": { "field": "reason" } }`.

---

## License

MIT License — free to use, modify, and deploy for personal or commercial projects.

---

*Built with ❤️ for Uzbekistan's small business community.*
