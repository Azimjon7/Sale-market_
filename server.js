const path = require("path");
if (require.main === module) {
  // Always load this project's environment file, even when the server is
  // launched from another working directory. Existing process variables keep
  // their normal precedence.
  require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
}
const { randomUUID, randomBytes, createHash, timingSafeEqual } = require("crypto");
const { publicFiles, safeFile } = require("./utils/publicFiles");
const { createObjectStorage } = require('./utils/objectStorage');
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const multer = require("multer");
const session = require('express-session');

const { readJSON, writeJSON } = require("./utils/jsonStore");
const {
  readCounters,
  writeCounters,
  allocateProductSku,
  allocateOrderNumber,
  withIdentifierLock,
} = require("./utils/identifierStore");
const { sendOrderNotification } = require("./utils/telegram");
const { cacheBuyoGalleryImages } = require("./utils/cacheBuyoGalleryImages");
const productRules = require('./js/product-rules');
const verifyAdminToken = require("./middleware/verifyAdminToken");
const { initializeOrderWithExtendedSchema, confirmOrder, rejectOrder, updateOrderStatus, recordPaymentCollection, getStatusLabel, StatusTransitions, OrderStatus } = require("./js/order-schema");
const { isInventoryManaged, validateProductStockForCheckout, integer } = require('./utils/inventoryValidator');
const { initializeProductInventory, adjustStockManually } = require('./utils/stockReservation');
const { getStockHistory, MOVEMENT_TYPES } = require('./utils/stockAudit');
const { reserveOrderInventory, commitOrderInventory, restoreOrderInventory, managedReservations } = require('./utils/orderInventoryIntegration');
const FileSessionStore = require('./utils/fileSessionStore');
const { installCustomerAuth } = require('./utils/customerAuth');
const { createPostgresPool } = require('./utils/postgres/pool');
const { PostgresSessionStore } = require('./utils/postgres/sessionStore');
const { PostgresCatalogRepository } = require('./utils/postgres/catalogRepository');
const { PostgresCustomerRepository } = require('./utils/postgres/customerRepository');
const { PostgresOrderInventoryRepository } = require('./utils/postgres/orderInventoryRepository');
const { PostgresOrderReadRepository } = require('./utils/postgres/orderReadRepository');
const { PostgresCategoryRepository } = require('./utils/postgres/categoryRepository');
const { PostgresPromoCodeRepository } = require('./utils/postgres/promoCodeRepository');
const { PostgresReviewRepository } = require('./utils/postgres/reviewRepository');

// ── Startup environment validation ───────────────────────────────────────────
function validateEnv() {
  const missing = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    missing.push("JWT_SECRET (required, minimum 32 characters)");
  }
  if (!process.env.ADMIN_USERNAME) missing.push("ADMIN_USERNAME (required)");
  if (!process.env.ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD (required)");

  if (missing.length) {
    console.error(
      "[FATAL] Missing or invalid required environment variables:\n  - " +
        missing.join("\n  - ") +
        "\nServer will not start. See .env.example."
    );
    process.exit(1);
  }

  if (require.main === module && (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID)) {
    console.warn(
      "[WARN] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Telegram notifications are disabled (orders still work)."
    );
  }
}
function createApp(options = {}) {
// Imported apps must explicitly use isolated storage; importing never starts a server.
if (require.main !== module && (!options.dataDir || !options.uploadsDir ||
    path.resolve(options.dataDir) === path.join(__dirname, 'data') ||
    path.resolve(options.uploadsDir) === path.join(__dirname, 'uploads'))) {
  throw new Error('Imported app requires isolated dataDir and uploadsDir');
}
validateEnv();
const notifyOrder = options.notifyOrder || (require.main === module ? sendOrderNotification : async () => {});
const app = express();
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const STORAGE_BACKEND = String(options.storageBackend || process.env.STORAGE_BACKEND || 'json').trim().toLowerCase();
if (!['json', 'postgresql'].includes(STORAGE_BACKEND)) throw new Error('STORAGE_BACKEND faqat json yoki postgresql bo‘lishi mumkin.');
const PUBLIC_WRITES_ENABLED = String(process.env.PUBLIC_WRITES_ENABLED ??
  (process.env.NODE_ENV === 'production' ? 'false' : 'true')).trim().toLowerCase() === 'true';
const postgresPool = STORAGE_BACKEND === 'postgresql' ? (options.postgresPool || createPostgresPool(options.env || process.env)) : null;
const postgresCatalog = postgresPool ? new PostgresCatalogRepository(postgresPool) : null;
const postgresCustomers = postgresPool ? new PostgresCustomerRepository(postgresPool) : null;
const postgresOrders = postgresPool ? new PostgresOrderInventoryRepository(postgresPool, options.postgresOrderOptions) : null;
const postgresOrderRead = postgresPool ? new PostgresOrderReadRepository(postgresPool) : null;
const postgresCategories = postgresPool ? new PostgresCategoryRepository(postgresPool) : null;
const postgresPromocodes = postgresPool ? new PostgresPromoCodeRepository(postgresPool) : null;
const postgresReviews = postgresPool ? new PostgresReviewRepository(postgresPool) : null;

const DATA_DIR = options.dataDir || path.join(__dirname, "data");
const UPLOADS_DIR = options.uploadsDir || path.join(__dirname, "uploads");
const objectStorage = options.objectStorage || createObjectStorage({
  env: options.env || process.env,
  projectRoot: __dirname,
  uploadsDir: UPLOADS_DIR,
  s3Client: options.s3Client,
});
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const CATEGORIES_FILE = path.join(DATA_DIR, "categories.json");
const PROMOCODES_FILE = path.join(DATA_DIR, "promocodes.json");
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");
const IDENTIFIERS_FILE = path.join(DATA_DIR, "identifier-counters.json");
const INVENTORY_STATE_FILE = path.join(DATA_DIR, "inventory-state.json");
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const CUSTOMER_SESSIONS_FILE = path.join(DATA_DIR, 'customer-sessions.json');
const AUTH_TOKENS_FILE = path.join(DATA_DIR, 'auth-tokens.json');

const DEFAULT_CATEGORIES = [
  "Futbolkalar",
  "Aksesuarlar",
  "Ustki kiyimlar",
  "Shimlar",
  "Oyoq kiyimlar",
  "Bosh kiyimlar",
  "Jihozlar",
  "Sumkalar",
  "Yostiq",
  "Shampun",
  "Teri parvarishi",
  "Mebel",
  "Uy jihozlari",
  "Oshxona",
  "Tozalash",
  "Yoritish",
  "Sport",
  "Bolalar",
  "Go‘zallik",
  "Elektronika",
  "Parfyumeriya",
  "Ayollar kiyimi",
  "Ayollar poyabzali",
  "Erkaklar kiyimi",
  "Erkaklar poyabzali",
  "Avtomobil",
];

const ORDER_STATUSES = ["Qabul qilindi", "Tayyorlanmoqda", "Yetkazilmoqda", "Yetkazildi", "Bekor qilindi"];
const ORDER_STATUS_KEYS = ["new", ...Object.values(OrderStatus)];
const ORDER_STATUS_LABELS = {
  new: "Yangi",
  confirmed: "Tasdiqlandi",
  shipped: "Jo'natildi",
  delivered: "Yetkazildi",
  cancelled: "Bekor qilindi",
};
const ORDER_STATUS_ALIASES = {
  yangi: "new",
  "qabul qilindi": "new",
  new: "new",
  tasdiqlandi: "confirmed",
  tayyorlanmoqda: "production",
  confirmed: "confirmed",
  "yo'lda": "shipped",
  "yo`lda": "shipped",
  "yo‘lda": "shipped",
  "yo’lda": "shipped",
  yolda: "shipped",
  yuborildi: "shipped",
  yetkazilmoqda: "shipped",
  shipped: "shipped",
  yetkazildi: "delivered",
  delivered: "delivered",
  "bekor qilindi": "cancelled",
  cancelled: "cancelled",
};
const PRODUCT_LABELS = ["", "Yangi", "Bestseller", "Chegirma", "Top mahsulot"];
const DEFAULT_PROMOCODES = [
  { code: "SALE10", discountPercent: 10, createdAt: new Date().toISOString() },
  { code: "SUMMER20", discountPercent: 20, createdAt: new Date().toISOString() },
];
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

// ── Security & body-parsing middleware (order matters) ───────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// Railway terminates HTTPS at its proxy. Trust exactly that first proxy so
// secure customer session cookies and rate-limit client IPs work correctly.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

const corsOptions =
  process.env.NODE_ENV === "production" && process.env.ALLOWED_ORIGIN
    ? { origin: process.env.ALLOWED_ORIGIN }
    : { origin: true };
app.use(cors(corsOptions));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
// PostgreSQL is authoritative in production; do not create or mutate JSON
// auth/session files on an ephemeral application filesystem.
if (!postgresPool) {
  ensureFile(CUSTOMERS_FILE, []);
  ensureFile(CUSTOMER_SESSIONS_FILE, {});
  ensureFile(AUTH_TOKENS_FILE, []);
}
app.use(session({
  name: 'dodola_customer', secret: process.env.CUSTOMER_SESSION_SECRET || JWT_SECRET,
  store: postgresPool ? new PostgresSessionStore(postgresPool) : new FileSessionStore(CUSTOMER_SESSIONS_FILE), resave: false, saveUninitialized: false,
  rolling: true, cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Keep customer-facing business writes closed on a new production deployment
// until the final public launch is explicitly approved. Login/logout remain
// available for smoke testing; admin routes retain their own authorization.
const launchLockedPublicWrites = new Set([
  'POST /orders',
  'POST /reviews',
  'POST /promocodes/apply',
  'POST /auth/register',
  'POST /auth/verify-email',
  'POST /auth/resend-verification',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'PATCH /customer/profile',
  'PUT /customer/addresses',
  'POST /customer/change-password',
]);
app.use('/api', (req, res, next) => {
  const key = `${req.method.toUpperCase()} ${req.path}`;
  const customerDelete = req.method === 'DELETE' && req.path.startsWith('/customer/addresses/');
  if (!PUBLIC_WRITES_ENABLED && (launchLockedPublicWrites.has(key) || customerDelete)) {
    return res.status(503).json({
      success: false,
      code: 'PUBLIC_LAUNCH_LOCKED',
      message: 'Sayt ishga tushirishga tayyorlanmoqda. Bu amal hozircha yopiq.',
    });
  }
  next();
});

app.get('/api/health', async (req, res) => {
  try {
    if (postgresPool) await postgresPool.query('SELECT 1');
    res.json({
      ok: true,
      storageBackend: STORAGE_BACKEND,
      fileStorageBackend: objectStorage.backend,
      publicWritesEnabled: PUBLIC_WRITES_ENABLED,
    });
  } catch (error) {
    res.status(503).json({ ok: false, code: 'DEPENDENCY_UNAVAILABLE' });
  }
});

app.use(publicFiles({ root: __dirname, uploadsDir: UPLOADS_DIR,
  getProducts: () => postgresCatalog ? postgresCatalog.listProducts() : readJSON(PRODUCTS_FILE, []),
  objectStorage }));

// Rate limiter: max 5 admin-login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
});
const trackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many tracking attempts. Try again later." },
});

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFile(filePath, defaultData = []) {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), "utf8");
  }
}

function readJson(filePath, defaultData = []) {
  ensureFile(filePath, defaultData);
  return readJSON(filePath, defaultData);
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  writeJSON(filePath, data);
  if (filePath === PRODUCTS_FILE && typeof productCache !== "undefined") {
    productCache.invalidate();
  }
}

function parseList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => String(v || "").trim()).filter(Boolean))];
  }
  const text = String(value || "").trim();
  if (!text) return [];
  return [...new Set(text.split(",").map((v) => v.trim()).filter(Boolean))];
}

function sanitizeText(value, maxLength = 500) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeMultiline(value, maxLength = 2000) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max, fallback = min) {
  const number = toNumber(value, fallback);
  return Math.min(max, Math.max(min, number));
}

function credentialsEqual(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

function getOrderStatusKey(status) {
  const text = String(status || "").trim();
  if (!text) return null;
  if (ORDER_STATUS_KEYS.includes(text)) return text;
  return ORDER_STATUS_ALIASES[text.toLowerCase()] ||
    Object.values(OrderStatus).find(key => getStatusLabel(key).toLowerCase() === text.toLowerCase()) || null;
}

function normalizeOrderStatusKey(status) {
  return getOrderStatusKey(status) || "new";
}

function normalizeOrderStatus(status) {
  const key = normalizeOrderStatusKey(status);
  return key === "new" ? ORDER_STATUS_LABELS.new : getStatusLabel(key);
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length > 9 && digits.startsWith("998")) return digits.slice(-9);
  return digits;
}

function readCategories() {
  const categories = readJson(CATEGORIES_FILE, DEFAULT_CATEGORIES);
  return Array.isArray(categories) ? categories.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function readPromocodes() {
  const promocodes = readJson(PROMOCODES_FILE, DEFAULT_PROMOCODES);
  if (!Array.isArray(promocodes)) return [];
  return promocodes
    .map((promo) => ({
      code: sanitizeText(promo.code, 40).toUpperCase(),
      discountPercent: clampNumber(promo.discountPercent, 1, 90, 1),
      createdAt: promo.createdAt || new Date().toISOString(),
    }))
    .filter((promo) => promo.code);
}

async function findPromocode(code) {
  const normalized = sanitizeText(code, 40).toUpperCase();
  if (!normalized) return null;
  if (postgresPromocodes) return postgresPromocodes.findValid(normalized);
  return readPromocodes().find((promo) => promo.code === normalized) || null;
}

function normalizeProductLabel(value) {
  const text = sanitizeText(value, 40);
  return PRODUCT_LABELS.includes(text) ? text : "";
}

function productWithDefaults(product) {
  const stock = product.stock === undefined || product.stock === null || product.stock === ""
    ? 999
    : Math.max(0, Math.floor(toNumber(product.stock, 0)));
  const { stockHistory, reserved, sold, returned, ...publicProduct } = product;
  return {
    ...publicProduct,
    stock,
    available: isInventoryManaged(product) ? integer(product.available) : stock,
    isLowStock: isInventoryManaged(product) && integer(product.available) <= integer(product.lowStockThreshold, 5),
    label: normalizeProductLabel(product.label || product.badge),
    badge: normalizeProductLabel(product.label || product.badge),
  };
}

function inventorySystemActive() {
  const state = readJSON(INVENTORY_STATE_FILE, {});
  return state && state.applied === true && Number(state.inventoryVersion) === 1;
}

/**
 * Validates product stock availability based on inventory mode.
 * 
 * Returns an object with:
 *   - valid: boolean indicating if the purchase is allowed
 *   - warning: string (optional) for warnings that don't block the purchase
 *   - error: string (optional) for errors that should block the purchase
 * 
 * Requirements: 1.2, 1.3, 4.1
 */
function validateProductStock(product, qty) {
  if (isInventoryManaged(product)) return validateProductStockForCheckout(product, qty);
  // Validate inputs
  if (!product) {
    return {
      valid: false,
      error: "Product not found"
    };
  }

  if (!qty || qty <= 0) {
    return {
      valid: false,
      error: "Quantity must be greater than 0"
    };
  }

  const inventoryMode = product._inventoryMode || "standard";

  // Made-to-order products: no stock validation
  if (inventoryMode === "made-to-order") {
    if (qty > 100) {
      return {
        valid: true,
        warning: "High quantity requested for made-to-order item"
      };
    }
    return { valid: true };
  }

  // Standard inventory mode: strict stock validation
  if (inventoryMode === "standard" || !inventoryMode) {
    const stock = product.stock === undefined || product.stock === null || product.stock === ""
      ? 999
      : Math.max(0, Math.floor(toNumber(product.stock, 0)));

    if (qty > stock) {
      return {
        valid: false,
        error: `Insufficient stock. Available: ${stock}, Requested: ${qty}`
      };
    }
    return { valid: true };
  }

  return {
    valid: false,
    error: "Unknown inventory mode"
  };
}

function publicOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber || null,
    name: order.name,
    phone: order.phone,
    address: order.address,
    note: order.note || "",
    total: toNumber(order.total, 0),
    subtotal: toNumber(order.subtotal, toNumber(order.total, 0)),
    discountAmount: toNumber(order.discountAmount, 0),
    promoCode: order.promoCode || "",
    items: Array.isArray(order.items) ? order.items : [],
    paymentType: order.paymentType || "naqd",
    paymentScreenshot: order.paymentScreenshot || "",
    status: normalizeOrderStatusKey(order.status),
    statusLabel: normalizeOrderStatus(order.status),
    paymentStatus: order.paymentStatus || 'pending',
    paymentDeadline: order.paymentDeadline || null,
    confirmedAt: order.confirmedAt || null,
    rejectionReason: order.rejectionReason || null,
    statusHistory: order.statusHistory || [],
    allowedNextStatuses: StatusTransitions[normalizeOrderStatusKey(order.status)] || [],
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || order.createdAt,
  };
}

function customerOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber || null,
    name: order.name,
    phone: order.phone,
    address: order.address,
    total: toNumber(order.total, 0),
    paymentType: order.paymentType || "naqd",
    status: normalizeOrderStatusKey(order.status),
    paymentStatus: order.paymentStatus || 'pending',
    paymentDeadline: order.paymentDeadline || null,
    rejectionReason: order.rejectionReason || null,
    statusHistory: (order.statusHistory || []).map(({ status, changedAt, reason }) => ({ status, changedAt, reason })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || order.createdAt,
    items: Array.isArray(order.items) ? order.items : [],
  };
}

function collectUploadedPaths(files) {
  if (!files) return [];
  const list = [];
  const allowed = new Set(["imageFile", "imageFiles", "images"]);

  if (Array.isArray(files)) {
    files.forEach((f) => {
      if (f && (f.storageRef || f.filename) && allowed.has(String(f.fieldname || ""))) {
        list.push(f.storageRef || `uploads/${f.filename}`);
      }
    });
    return list;
  }

  Object.keys(files).forEach((key) => {
    const group = files[key];
    if (!allowed.has(String(key || ""))) return;
    if (!Array.isArray(group)) return;
    group.forEach((f) => {
      if (f && (f.storageRef || f.filename)) list.push(f.storageRef || `uploads/${f.filename}`);
    });
  });

  return list;
}

function getProductImages(product) {
  const images = Array.isArray(product.images) ? [...new Set(product.images.filter(Boolean))] : [];
  if (images.length) return images;
  return product.image ? [product.image] : [];
}

async function deleteUnreferencedUploadFiles(paths) {
  const candidates = [...new Set((paths || []).filter(img => String(img).startsWith('uploads/')))];
  if (!candidates.length) return;
  const products = postgresCatalog ? await postgresCatalog.listProducts() : readJson(PRODUCTS_FILE);
  const referenced = new Set(products.flatMap(getProductImages));
  for (const image of candidates) {
    if (referenced.has(image)) continue;
    try { await objectStorage.delete(image); }
    catch (error) { console.warn('[storage-delete]', { code: error.code || error.name || 'DELETE_FAILED' }); }
  }
}

ensureDir(UPLOADS_DIR);

const storage = objectStorage.createMulterStorage(multer);

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE, files: 12 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowed = new Map([
      ['.jpg', new Set(['image/jpeg'])], ['.jpeg', new Set(['image/jpeg'])],
      ['.png', new Set(['image/png'])], ['.webp', new Set(['image/webp'])],
      ['.gif', new Set(['image/gif'])], ['.avif', new Set(['image/avif'])],
    ]);
    if (!allowed.has(ext) || !allowed.get(ext).has(String(file.mimetype || "").toLowerCase())) {
      return cb(new Error("Faqat rasm fayllarini yuklash mumkin"));
    }
    cb(null, true);
  },
});
function guardedUpload(middleware) {
  return (req, res, next) => middleware(req, res, error => {
    if (error) return next(error);
    let committed = false;
    req.commitUploadedFiles = () => { committed = true; };
    res.once('finish', () => {
      if (committed) return;
      const files = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
      Promise.all(files.map(file => objectStorage.delete(file.storageRef || `uploads/${file.filename}`, { visibility: file.visibility || 'public' })))
        .catch(storageError => console.warn('[storage-cleanup]', { code: storageError.code || storageError.name || 'CLEANUP_FAILED' }));
    });
    next();
  });
}
const productUpload = guardedUpload(upload.any());

function normalizeProduct(body, uploadedFiles) {
  const existingImages = parseList(body.existingImages || body.existingImage);
  const uploadedPaths = collectUploadedPaths(uploadedFiles);
  // Keep newly uploaded images first so home/shop immediately reflect updates.
  const images = [...new Set([...uploadedPaths, ...existingImages].filter(Boolean))];

  // Validate inventoryMode if provided
  const inventoryMode = body.inventoryMode ?? body._inventoryMode ?? "standard";
  if (!["standard", "made-to-order"].includes(inventoryMode)) {
    throw Object.assign(new Error(`Invalid inventoryMode: ${inventoryMode}. Must be 'standard' or 'made-to-order'.`), { status: 400 });
  }

  return {
    id: body.id || `prd_${randomUUID()}`,
    name: sanitizeText(body.name, 160),
    price: Math.max(0, toNumber(body.price, 0)),
    oldPrice: Math.max(0, toNumber(body.oldPrice, 0)),
    category: sanitizeText(body.category, 120),
    desc: sanitizeMultiline(body.desc || body.description, 2000),
    image: images[0] || "",
    images,
    sizes: sanitizeText(body.sizes, 300),
    colors: sanitizeText(body.colors, 300),
    stock: Math.max(0, Math.floor(toNumber(body.stock, inventorySystemActive() ? 15 : 999))),
    label: normalizeProductLabel(body.label || body.badge),
    createdAt: body.createdAt || new Date().toISOString(),
    _inventoryMode: inventoryMode,
    _acceptsMTO: body._acceptsMTO === true || body._acceptsMTO === "true",
    _productionDays: Math.max(1, Math.floor(toNumber(body._productionDays, 14))),
    _buyo_id: body._buyo_id || null,
  };
}
app.post("/api/admin/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};

  if (
    credentialsEqual(username, process.env.ADMIN_USERNAME) &&
    credentialsEqual(password, process.env.ADMIN_PASSWORD)
  ) {
    const token = jwt.sign(
      {
        username,
        role: "admin",
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.json({
      success: true,
      token,
    });
  }

  return res.status(401).json({
    success: false,
    message: "Login yoki parol noto'g'ri",
  });
});

installCustomerAuth(app, { dataDir: DATA_DIR, customersFile: CUSTOMERS_FILE, tokensFile: AUTH_TOKENS_FILE,
  ordersFile: ORDERS_FILE, jwt, jwtSecret: JWT_SECRET, adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD, credentialsEqual, emailSender: options.emailSender,
  emailService: options.emailService, customerRepository: postgresCustomers });

// Backwards-compatible alias — delegates to the reusable middleware module.
const verifyAdmin = verifyAdminToken;

// ── In-memory product cache (60s TTL) ────────────────────────────────────────
const productCache = {
  data: null,
  timestamp: 0,
  TTL: 60 * 1000,
  get() {
    if (this.data && Date.now() - this.timestamp < this.TTL) return this.data;
    return null;
  },
  set(data) {
    this.data = data;
    this.timestamp = Date.now();
  },
  invalidate() {
    this.data = null;
    this.timestamp = 0;
  },
};

function loadProductsCached() {
  let all = productCache.get();
  if (!all) {
    all = readJson(PRODUCTS_FILE).map(productWithDefaults);
    productCache.set(all);
  }
  return all;
}

async function sortProducts(products, sort) {
  const cmp = (a, b) => String(a.id).localeCompare(String(b.id));
  switch (sort) {
    case "price-low":
      return [...products].sort((a, b) => (a.price - b.price) || cmp(a, b));
    case "price-high":
      return [...products].sort((a, b) => (b.price - a.price) || cmp(a, b));
    case "most-reviewed": {
      const counts = postgresReviews ? await postgresReviews.countsByProduct() : {};
      if (!postgresReviews) (Array.isArray(readJson(REVIEWS_FILE, [])) ? readJson(REVIEWS_FILE, []) : []).forEach((r) => {
        counts[r.productId] = (counts[r.productId] || 0) + 1;
      });
      return [...products].sort(
        (a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || cmp(a, b)
      );
    }
    case "newest":
    default:
      return [...products].sort(
        (a, b) => (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) || cmp(a, b)
      );
  }
}

app.get("/api/products", async (req, res, next) => {
  try {
  let all = postgresCatalog ? (await postgresCatalog.listProducts(req.query.search || '')).map(productWithDefaults) : loadProductsCached();

  // Filtering (applies whether or not pagination is requested)
  const category = req.query.category;
  if (category) {
    all = all.filter(
      (p) => String(p.category || "").toLowerCase() === String(category).toLowerCase()
    );
  }
  const search = req.query.search;
  if (search) {
    const lc = String(search).toLowerCase();
    all = all.filter(
      (p) =>
        String(p.name || "").toLowerCase().includes(lc) ||
        String(p.sku || "").toLowerCase().includes(lc) ||
        String(p.desc || p.description || "").toLowerCase().includes(lc)
    );
  }

  const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
  const hasSort = req.query.sort !== undefined;

  if (hasSort) {
    all = await sortProducts(all, String(req.query.sort));
  }

  // Backward-compatible: no pagination params -> return plain array (frontend relies on this)
  if (!hasPagination) {
    return res.json(all);
  }

  // Paginated response with validation
  let page = parseInt(req.query.page, 10);
  let limit = parseInt(req.query.limit, 10);
  if (req.query.page !== undefined && (!Number.isInteger(page) || page < 1)) {
    return res.status(400).json({ error: "Validation failed", details: { page: "page must be a positive integer" } });
  }
  if (req.query.limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return res.status(400).json({ error: "Validation failed", details: { limit: "limit must be an integer between 1 and 100" } });
  }
  page = page || 1;
  limit = limit || 20;

  if (!hasSort) all = await sortProducts(all, "newest");

  const total = all.length;
  const pages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const products = all.slice(start, start + limit);

  res.json({ products, meta: { total, page, limit, pages } });
  } catch (error) { next(error); }
});

app.get("/api/categories", async (req, res, next) => {
  try { res.json(postgresCategories ? await postgresCategories.list() : readCategories()); }
  catch (error) { next(error); }
});

app.post("/api/categories", verifyAdmin, async (req, res, next) => {
  try {
  const name = sanitizeText(req.body.name || req.body.category, 120);

  if (!name) {
    return res.status(400).json({ message: "Kategoriya nomi kiritilmadi" });
  }

  if (postgresCategories) return res.json({ success: true, categories: await postgresCategories.create(name) });
  const categories = readCategories();
  const exists = categories.some((item) => item.toLowerCase() === name.toLowerCase());

  if (!exists) {
    categories.push(name);
    writeJson(CATEGORIES_FILE, categories);
  }

  res.json({ success: true, categories });
  } catch (error) { next(error); }
});

app.delete("/api/categories/:name", verifyAdmin, async (req, res, next) => {
  try {
  const target = sanitizeText(req.params.name, 120);
  if (postgresCategories) {
    const result = await postgresCategories.delete(target);
    if (!result.found) return res.status(404).json({ message: "Kategoriya topilmadi" });
    if (result.assigned) return res.status(409).json({ message: `Kategoriyaga ${result.assigned} ta mahsulot biriktirilgan` });
    return res.json({ success: true, categories: result.categories });
  }
  const categories = readCategories();
  const filtered = categories.filter((item) => item.toLowerCase() !== target.toLowerCase());

  if (filtered.length === categories.length) {
    return res.status(404).json({ message: "Kategoriya topilmadi" });
  }

  writeJson(CATEGORIES_FILE, filtered);
  res.json({ success: true, categories: filtered });
  } catch (error) { next(error); }
});

app.put("/api/categories/:name", verifyAdmin, async (req, res, next) => {
  try {
  const target = sanitizeText(req.params.name, 120);
  const nextName = sanitizeText(req.body.name || req.body.category, 120);

  if (!target || !nextName) {
    return res.status(400).json({ message: "Kategoriya nomi kiritilmadi" });
  }

  if (postgresCategories) {
    const result = await postgresCategories.rename(target, nextName);
    if (!result.found) return res.status(404).json({ message: "Kategoriya topilmadi" });
    if (result.duplicate) return res.status(400).json({ message: "Bunday kategoriya mavjud" });
    return res.json({ success: true, categories: result.categories });
  }
  const categories = readCategories();
  const index = categories.findIndex((item) => item.toLowerCase() === target.toLowerCase());

  if (index === -1) {
    return res.status(404).json({ message: "Kategoriya topilmadi" });
  }

  const duplicate = categories.some((item, i) => i !== index && item.toLowerCase() === nextName.toLowerCase());
  if (duplicate) {
    return res.status(400).json({ message: "Bunday kategoriya mavjud" });
  }

  categories[index] = nextName;
  writeJson(CATEGORIES_FILE, categories);

  const products = readJson(PRODUCTS_FILE);
  let changed = false;
  const updatedProducts = products.map((product) => {
    if (String(product.category || "").toLowerCase() !== target.toLowerCase()) return product;
    changed = true;
    return { ...product, category: nextName };
  });
  if (changed) writeJson(PRODUCTS_FILE, updatedProducts);

  res.json({ success: true, categories });
  } catch (error) { next(error); }
});

app.get("/api/products/:id", async (req, res, next) => {
  try {
  const product = postgresCatalog ? await postgresCatalog.getProduct(req.params.id) : readJson(PRODUCTS_FILE).find((p) => String(p.id) === String(req.params.id));

  if (!product) {
    return res.status(404).json({ message: "Mahsulot topilmadi" });
  }

  res.json(productWithDefaults(product));
  } catch (error) { next(error); }
});

app.post("/api/products", verifyAdmin, productUpload, async (req, res, next) => {
  try {
    if (postgresCatalog) {
      const product = normalizeProduct(req.body, req.files);
      if (!product.name || !product.category || !product.desc || !product.price) return res.status(400).json({ message: "Majburiy maydonlar toldirilmagan: nomi, kategoriya, tavsif, narx kerak" });
      if (!product.images || !product.images.length) return res.status(400).json({ message: "Kamida bitta rasm kerak" });
      const created = await postgresCatalog.createProduct({ ...product, inventoryManaged: true, available: Math.max(0, integer(product.stock, 15)), lowStockThreshold: 5 });
      req.commitUploadedFiles();
      return res.json({ success: true, product: created });
    }
    await withIdentifierLock(DATA_DIR, async () => {
      const products = readJson(PRODUCTS_FILE);
      const orders = readJson(ORDERS_FILE);
      const product = normalizeProduct(req.body, req.files);

      if (!product.name || !product.category || !product.desc || !product.price) {
        return res.status(400).json({ message: "Majburiy maydonlar toldirilmagan: nomi, kategoriya, tavsif, narx kerak" });
      }

      if (!product.images || !product.images.length) {
        return res.status(400).json({ message: "Kamida bitta rasm kerak" });
      }

      const counters = readCounters(IDENTIFIERS_FILE, products, orders);
      product.sku = allocateProductSku(counters, products);
      if (inventorySystemActive()) {
        Object.assign(product, initializeProductInventory(product, Math.max(0, integer(product.stock, 15)), req.user.username).product);
      }
      // Persist the allocation first. A later write failure may leave a gap,
      // but the SKU can never be reused.
      writeCounters(IDENTIFIERS_FILE, counters);
      products.unshift(product);
      writeJson(PRODUCTS_FILE, products);
      productCache.invalidate();

      req.commitUploadedFiles();
      res.json({ success: true, product });
    });
  } catch (err) {
    if (err.message && err.message.includes("Invalid inventoryMode")) {
      return res.status(400).json({ 
        success: false,
        message: err.message,
        details: { inventoryMode: err.message }
      });
    }
    next(err);
  }
});

app.put("/api/products/:id", verifyAdmin, productUpload, async (req, res, next) => {
  try {
    if (postgresCatalog) {
      const current = await postgresCatalog.getProduct(req.params.id);
      if (!current) return res.status(404).json({ message: "Mahsulot topilmadi" });
      const currentImages = getProductImages(current);
      const requestedExisting = parseList(req.body.existingImages || req.body.existingImage);
      const hasExistingField = Object.prototype.hasOwnProperty.call(req.body, 'existingImages') || Object.prototype.hasOwnProperty.call(req.body, 'existingImage');
      const changes = normalizeProduct({ ...current, ...req.body, id: current.id, createdAt: current.createdAt,
        existingImages: hasExistingField ? requestedExisting.join(',') : currentImages.join(',') }, req.files);
      const updated = await postgresCatalog.updateProduct(current.id, changes);
      await deleteUnreferencedUploadFiles(currentImages.filter(img => !getProductImages(updated).includes(img)));
      req.commitUploadedFiles();
      return res.json({ success: true, product: updated });
    }
    await withIdentifierLock(DATA_DIR, async () => {
      const products = readJson(PRODUCTS_FILE);
      const index = products.findIndex((p) => String(p.id) === String(req.params.id));

      if (index === -1) {
        return res.status(404).json({ message: "Mahsulot topilmadi" });
      }

      const current = products[index];
      const currentImages = getProductImages(current);
      const requestedExisting = parseList(req.body.existingImages || req.body.existingImage);
      const hasExistingField = Object.prototype.hasOwnProperty.call(req.body, 'existingImages') || Object.prototype.hasOwnProperty.call(req.body, 'existingImage');
      const updated = { ...current, ...normalizeProduct(
        {
          ...current,
          ...req.body,
          id: current.id,
          createdAt: current.createdAt,
          // Respect client-side per-image removals while retaining their order.
          existingImages: hasExistingField ? requestedExisting.join(",") : currentImages.join(","),
        },
        req.files
      ), sku: current.sku };

      if (isInventoryManaged(current)) {
        Object.assign(updated, {
          inventoryManaged: current.inventoryManaged,
          inventoryVersion: current.inventoryVersion,
          inventoryInitializedAt: current.inventoryInitializedAt,
          stock: current.stock,
          available: current.available,
          reserved: current.reserved,
          sold: current.sold,
          returned: current.returned,
          lowStockThreshold: current.lowStockThreshold,
          stockHistory: current.stockHistory,
        });
      }

      const removedImages = currentImages.filter((img) => !updated.images.includes(img));
      products[index] = updated;
      writeJson(PRODUCTS_FILE, products);
      productCache.invalidate();
      // Delete only after the updated catalog is durable and no product refers to the object.
      await deleteUnreferencedUploadFiles(removedImages);

      req.commitUploadedFiles();
      res.json({ success: true, product: updated });
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/products/:id", verifyAdmin, async (req, res, next) => {
  try {
    if (postgresCatalog) {
      const target = await postgresCatalog.getProduct(req.params.id);
      if (!target) return res.status(404).json({ message: 'Mahsulot topilmadi' });
      const deleted = await postgresCatalog.deleteProduct(req.params.id);
      if (!deleted) return res.status(409).json({ message: "Bronlangan qoldig'i bor mahsulotni o'chirib bo'lmaydi." });
      await deleteUnreferencedUploadFiles(getProductImages(target));
      return res.json({ success: true });
    }
    await withIdentifierLock(DATA_DIR, async () => {
      const products = readJson(PRODUCTS_FILE);
      const target = products.find((p) => String(p.id) === String(req.params.id));

      if (target && isInventoryManaged(target) && integer(target.reserved) > 0) {
        return res.status(409).json({ message: "Bronlangan qoldig'i bor mahsulotni o'chirib bo'lmaydi." });
      }

      const imagePaths = target ? getProductImages(target) : [];

      const filtered = products.filter((p) => String(p.id) !== String(req.params.id));
      writeJson(PRODUCTS_FILE, filtered);
      productCache.invalidate();
      await deleteUnreferencedUploadFiles(imagePaths);

      res.json({ success: true });
    });
  } catch (error) {
    next(error);
  }
});

function inventorySummary(product) {
  return {
    productId: product.id,
    sku: product.sku || null,
    available: integer(product.available),
    reserved: integer(product.reserved),
    sold: integer(product.sold),
    returned: integer(product.returned),
    lowStockThreshold: integer(product.lowStockThreshold, 5),
    isLowStock: integer(product.available) <= integer(product.lowStockThreshold, 5),
  };
}

app.patch('/api/products/:id/stock', verifyAdmin, async (req, res, next) => {
  try {
    if (postgresCatalog) {
      const change = Number(req.body.change), reason = sanitizeText(req.body.reason, 500);
      if (!Number.isInteger(change) || change === 0) return res.status(400).json({ message: "O'zgarish noldan farqli butun son bo'lishi kerak." });
      try {
        const result = await postgresCatalog.adjustStock(req.params.id, change, reason, req.user.id || req.user.userId || req.user.username);
        if (!result) return res.status(404).json({ message: 'Mahsulot topilmadi.' });
        return res.json({ success: true, ...result });
      } catch (error) { if (error.code === 'INVALID_STOCK_CHANGE') return res.status(400).json({ message: error.message }); throw error; }
    }
    await withIdentifierLock(DATA_DIR, async () => {
      const products = readJson(PRODUCTS_FILE);
      const index = products.findIndex(product => String(product.id) === String(req.params.id));
      if (index < 0) return res.status(404).json({ message: 'Mahsulot topilmadi.' });
      if (!isInventoryManaged(products[index])) return res.status(409).json({ message: 'Mahsulot ombor hisobiga hali kiritilmagan.' });
      const change = Number(req.body.change);
      if (!Number.isInteger(change) || change === 0) return res.status(400).json({ message: "O'zgarish noldan farqli butun son bo'lishi kerak." });
      const reason = sanitizeText(req.body.reason, 500);
      const actor = req.user.id || req.user.userId || req.user.username;
      let result;
      try { result = adjustStockManually(products[index], change, reason, actor); }
      catch (error) { return res.status(400).json({ message: error.message }); }
      writeJson(PRODUCTS_FILE, products);
      productCache.invalidate();
      res.json({ success: true, inventory: inventorySummary(products[index]), movement: result.movement });
    });
  } catch (error) { next(error); }
});

app.get('/api/products/:id/stock-history', verifyAdmin, async (req, res, next) => {
  try {
  const pgResult = postgresCatalog ? await postgresCatalog.stockHistory(req.params.id, { type: req.query.type, startDate: req.query.startDate, endDate: req.query.endDate }) : null;
  const product = postgresCatalog ? pgResult && pgResult.product : readJson(PRODUCTS_FILE).find(row => String(row.id) === String(req.params.id));
  if (!product) return res.status(404).json({ message: 'Mahsulot topilmadi.' });
  if (!isInventoryManaged(product)) return res.status(409).json({ message: 'Mahsulot ombor hisobiga hali kiritilmagan.' });
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 25);
  if (!Number.isInteger(page) || page < 1 || ![10, 25, 50, 100].includes(limit)) {
    return res.status(400).json({ message: "Sahifa yoki yozuvlar soni noto'g'ri." });
  }
  const type = String(req.query.type || '');
  if (type && !MOVEMENT_TYPES.includes(type)) return res.status(400).json({ message: "Harakat turi noto'g'ri." });
  const history = postgresCatalog ? pgResult.history : getStockHistory(product, { type, startDate: req.query.startDate, endDate: req.query.endDate });
  const total = history.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(page, pages);
  res.json({ inventory: inventorySummary(product), history: history.slice((currentPage - 1) * limit, currentPage * limit),
    meta: { total, page: currentPage, limit, pages } });
  } catch (error) { next(error); }
});

app.get('/api/products/:id/stock-history/export', verifyAdmin, async (req, res, next) => {
  try {
  const pgResult = postgresCatalog ? await postgresCatalog.stockHistory(req.params.id, { type: req.query.type, startDate: req.query.startDate, endDate: req.query.endDate }) : null;
  const product = postgresCatalog ? pgResult && pgResult.product : readJson(PRODUCTS_FILE).find(row => String(row.id) === String(req.params.id));
  if (!product) return res.status(404).json({ message: 'Mahsulot topilmadi.' });
  if (!isInventoryManaged(product)) return res.status(409).json({ message: 'Mahsulot ombor hisobiga hali kiritilmagan.' });
  const type = String(req.query.type || '');
  if (type && !MOVEMENT_TYPES.includes(type)) return res.status(400).json({ message: "Harakat turi noto'g'ri." });
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const rows = (postgresCatalog ? pgResult.history : getStockHistory(product, { type, startDate: req.query.startDate, endDate: req.query.endDate }))
    .map(item => [item.timestamp, item.type, item.change, item.oldBalance, item.newBalance, item.reason, item.actor, item.orderId]
      .map(quote).join(','));
  const csv = ['Vaqt,Harakat,Ozgarish,Oldingi qoldiq,Yangi qoldiq,Sabab,Bajaruvchi,Buyurtma ID', ...rows].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${String(product.sku || product.id).replace(/[^\w-]/g, '_')}-ombor-tarixi.csv"`);
  res.send('\ufeff' + csv);
  } catch (error) { next(error); }
});

app.get("/api/promocodes", verifyAdmin, async (req, res, next) => {
  try { res.json(postgresPromocodes ? await postgresPromocodes.list() : readPromocodes()); }
  catch (error) { next(error); }
});

app.post("/api/promocodes", verifyAdmin, async (req, res, next) => {
  try {
  const code = sanitizeText(req.body.code, 40).toUpperCase();
  const discountPercent = clampNumber(req.body.discountPercent, 1, 90, 1);

  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    return res.status(400).json({ message: "Promokod kamida 3 ta belgi bo'lishi kerak" });
  }

  if (postgresPromocodes) {
    const promocodes = await postgresPromocodes.upsert({ code, discountPercent });
    return res.json({ success: true, promocodes });
  }
  const promocodes = readPromocodes();
  const index = promocodes.findIndex((promo) => promo.code === code);
  const promo = { code, discountPercent, createdAt: index === -1 ? new Date().toISOString() : promocodes[index].createdAt };

  if (index === -1) promocodes.push(promo);
  else promocodes[index] = promo;

  writeJson(PROMOCODES_FILE, promocodes);
  res.json({ success: true, promocodes });
  } catch (error) { next(error); }
});

app.delete("/api/promocodes/:code", verifyAdmin, async (req, res, next) => {
  try {
  const code = sanitizeText(req.params.code, 40).toUpperCase();
  if (postgresPromocodes) {
    const result = await postgresPromocodes.delete(code);
    if (!result.found) return res.status(404).json({ message: "Promokod topilmadi" });
    if (result.used) return res.status(409).json({ message: "Ishlatilgan promokodni o‘chirib bo‘lmaydi" });
    return res.json({ success: true, promocodes: result.promocodes });
  }
  const promocodes = readPromocodes();
  const filtered = promocodes.filter((promo) => promo.code !== code);

  if (filtered.length === promocodes.length) {
    return res.status(404).json({ message: "Promokod topilmadi" });
  }

  writeJson(PROMOCODES_FILE, filtered);
  res.json({ success: true, promocodes: filtered });
  } catch (error) { next(error); }
});

app.post("/api/promocodes/apply", async (req, res, next) => {
  try {
  const promo = await findPromocode(req.body.code);
  if (!promo) {
    return res.status(404).json({ message: "Promokod topilmadi" });
  }

  const subtotal = Math.max(0, toNumber(req.body.subtotal || req.body.total, 0));
  const discountAmount = Math.floor((subtotal * promo.discountPercent) / 100);
  res.json({
    success: true,
    code: promo.code,
    discountPercent: promo.discountPercent,
    discountAmount,
    total: Math.max(0, subtotal - discountAmount),
  });
  } catch (error) { next(error); }
});

app.get("/api/reviews", async (req, res, next) => {
  try {
  const productId = String(req.query.productId || "").trim();
  if (postgresReviews) return res.json(await postgresReviews.list(productId));
  const reviews = readJson(REVIEWS_FILE);
  const list = (Array.isArray(reviews) ? reviews : []).filter((review) => {
    return !productId || String(review.productId) === productId;
  });
  res.json(list);
  } catch (error) { next(error); }
});

app.post("/api/reviews", async (req, res, next) => {
  try {
  const productId = sanitizeText(req.body.productId, 80);
  const name = sanitizeText(req.body.name, 80);
  const rating = clampNumber(req.body.rating, 1, 5, 5);
  const review = sanitizeMultiline(req.body.review, 800);

  if (!productId || !name || !review) {
    return res.status(400).json({ message: "Sharh uchun ma'lumot yetarli emas" });
  }

  if (postgresReviews) {
    const customer = req.session && req.session.customerId ? await postgresCustomers.findById(req.session.customerId) : null;
    const item = await postgresReviews.create({ productId, name: customer ? `${customer.firstName} ${customer.lastName}`.trim() : name,
      rating, review, customerId: customer ? customer.id : null });
    if (!item) return res.status(404).json({ message: "Mahsulot topilmadi" });
    return res.json({ success: true, review: item });
  }
  const products = readJson(PRODUCTS_FILE);
  const productExists = products.some((product) => String(product.id) === productId);
  if (!productExists) {
    return res.status(404).json({ message: "Mahsulot topilmadi" });
  }

  const reviews = readJson(REVIEWS_FILE);
  const item = {
    id: `rev_${Date.now()}`,
    productId,
    name,
    rating,
    review,
    createdAt: new Date().toISOString(),
  };

  reviews.unshift(item);
  writeJson(REVIEWS_FILE, reviews);
  res.json({ success: true, review: item });
  } catch (error) { next(error); }
});

app.delete("/api/reviews/:id", verifyAdmin, async (req, res, next) => {
  try {
  if (postgresReviews) {
    if (!await postgresReviews.delete(req.params.id)) return res.status(404).json({ message: "Sharh topilmadi" });
    return res.json({ success: true });
  }
  const reviews = readJson(REVIEWS_FILE);
  const filtered = reviews.filter((review) => String(review.id) !== String(req.params.id));
  if (filtered.length === reviews.length) {
    return res.status(404).json({ message: "Sharh topilmadi" });
  }
  writeJson(REVIEWS_FILE, filtered);
  res.json({ success: true });
  } catch (error) { next(error); }
});

function formatSom(value) {
  return `${Math.round(toNumber(value, 0)).toLocaleString("uz-UZ")} so'm`;
}

function excelCell(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function orderItemsText(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const qty = Math.max(1, toNumber(item.qty, 1));
      const name = item.name || "Mahsulot";
      const size = item.size ? `, o'lcham: ${item.size}` : "";
      const color = item.color ? `, rang: ${item.color}` : "";
      return `${name} x ${qty}${size}${color}`;
    })
    .join("; ");
}

function buildTelegramMessage(order) {
  const items = (Array.isArray(order.items) ? order.items : [])
    .map((item, index) => {
      const qty = Math.max(1, toNumber(item.qty, 1));
      const size = item.size ? ` | O'lcham: ${item.size}` : "";
      const color = item.color ? ` | Rang: ${item.color}` : "";
      return `${index + 1}. ${item.name || "Mahsulot"} x ${qty}${size}${color}`;
    })
    .join("\n");

  return [
    "🛒 Yangi buyurtma",
    "",
    `🆔 ID: ${order.id}`,
    `👤 Ism: ${order.name}`,
    `📞 Telefon: ${order.phone}`,
    `📍 Manzil: ${order.address}`,
    `💰 Summa: ${formatSom(order.total)}`,
    `💳 To'lov turi: ${order.paymentType === "karta" ? "Karta" : "Naqd"}`,
    order.promoCode ? `🎟 Promokod: ${order.promoCode} (-${formatSom(order.discountAmount)})` : "",
    "",
    "Mahsulotlar:",
    items || "-",
  ].filter(Boolean).join("\n");
}

async function sendTelegramOrder(order) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || typeof fetch !== "function") return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildTelegramMessage(order),
      }),
    });
  } catch (error) {
    console.error("Telegram xabari yuborilmadi:", error.message);
  }
}

async function buildOrderFromRequest(req, products) {
  const paymentType = String(req.body.paymentType || "naqd").trim().toLowerCase();

  let parsedItems = [];
  const parseItemsField = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const decoded = JSON.parse(value);
        return Array.isArray(decoded) ? decoded : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  parsedItems = parseItemsField(req.body.items);
  if (!parsedItems.length) parsedItems = parseItemsField(req.body.itemsJson);

  if (!parsedItems.length && req.body && typeof req.body === "object") {
    const map = {};
    Object.keys(req.body).forEach((key) => {
      const m = key.match(/^items\[(\d+)\]\[(\w+)\]$/);
      if (!m) return;
      const idx = Number(m[1]);
      const field = m[2];
      if (!map[idx]) map[idx] = {};
      map[idx][field] = req.body[key];
    });
    parsedItems = Object.keys(map)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => map[k]);
  }

  const enrichedItems = parsedItems.map((rawItem) => {
    const item = rawItem && typeof rawItem === "object" ? rawItem : {};
    const productId = String(item.productId || item.id || "").trim();
    const product = products.find((p) => String(p.id) === productId);
    const qty = Number(item.qty);
    const price = Math.max(0, toNumber(product ? product.price : item.price, 0));
    const inventoryMode = (product && product._inventoryMode) || "standard";
    const estimatedProduction = inventoryMode === "made-to-order" 
      ? new Date(new Date().getTime() + (product?._productionDays || 14) * 24 * 60 * 60 * 1000).toISOString()
      : null;
    
    return {
      productId,
      sku: sanitizeText((product && product.sku) || item.sku, 40),
      name: sanitizeText((product && product.name) || item.name || "Mahsulot", 180),
      size: sanitizeText(item.size, 80),
      color: sanitizeText(item.color, 80),
      qty,
      price,
      lineTotal: price * qty,
      inventoryMode,
      estimatedProduction,
    };
  });

  const subtotal = enrichedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const promo = await findPromocode(req.body.promoCode || req.body.promo);
  const discountAmount = promo ? Math.floor((subtotal * promo.discountPercent) / 100) : 0;

  return {
    id: `ord_${randomUUID()}`,
    name: sanitizeText(req.body.name, 120),
    phone: sanitizeText(req.body.phone, 60),
    address: sanitizeText(req.body.address, 260),
    note: sanitizeMultiline(req.body.note, 600),
    subtotal,
    discountAmount,
    promoCode: sanitizeText(req.body.promoCode || req.body.promo, 40).toUpperCase(),
    total: Math.max(0, subtotal - discountAmount),
    items: enrichedItems,
    paymentType: paymentType === "karta" ? "karta" : "naqd",
    paymentScreenshot: req.file ? (req.file.storageRef || `uploads/${req.file.filename}`) : "",
    createdAt: new Date().toISOString(),
  };
}

app.get("/api/orders", verifyAdmin, async (req, res, next) => {
  try {
  let orders = (postgresOrderRead ? await postgresOrderRead.listOrders() : readJson(ORDERS_FILE)).map(publicOrder);
  const wantsPage = req.query.page !== undefined || req.query.limit !== undefined ||
    req.query.search !== undefined || req.query.filter !== undefined || req.query.sort !== undefined;
  if (!wantsPage) return res.json(orders);

  const search = sanitizeText(req.query.search, 120).toLocaleLowerCase('uz');
  if (search) {
    orders = orders.filter(order => [order.orderNumber, order.id, order.name, order.phone]
      .some(value => String(value || '').toLocaleLowerCase('uz').includes(search)));
  }

  const filter = String(req.query.filter || 'all');
  const allowedFilters = new Set(['all', 'pending_confirmation', 'payment_pending', 'payment_confirmed',
    'production', 'shipped', 'delivered', 'rejected', 'cancelled', 'payment_failed']);
  if (!allowedFilters.has(filter)) {
    return res.status(400).json({ error: "Noto'g'ri buyurtma filtri" });
  }
  if (filter === 'pending_confirmation') {
    orders = orders.filter(order => ['new', 'pending_confirmation'].includes(order.status));
  } else if (filter === 'payment_confirmed') {
    orders = orders.filter(order => order.paymentStatus === 'collected');
  } else if (filter === 'payment_failed') {
    orders = orders.filter(order => order.paymentStatus === 'failed');
  } else if (filter !== 'all') {
    orders = orders.filter(order => order.status === filter);
  }

  const sort = String(req.query.sort || 'newest');
  const sorters = {
    newest: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    oldest: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
    'total-high': (a, b) => b.total - a.total,
    'total-low': (a, b) => a.total - b.total,
    updated: (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0),
  };
  if (!sorters[sort]) return res.status(400).json({ error: "Noto'g'ri saralash turi" });
  orders.sort((a, b) => sorters[sort](a, b) || String(b.id).localeCompare(String(a.id)));

  let page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  if (!Number.isInteger(page) || page < 1) return res.status(400).json({ error: "Sahifa raqami noto'g'ri" });
  if (![10, 25, 50].includes(limit)) return res.status(400).json({ error: "Sahifadagi buyurtmalar soni noto'g'ri" });
  const total = orders.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  page = Math.min(page, pages);
  const start = (page - 1) * limit;
  res.json({ orders: orders.slice(start, start + limit), meta: { total, page, limit, pages } });
  } catch (error) { next(error); }
});

app.get("/api/orders/export", verifyAdmin, async (req, res, next) => {
  try {
  const orders = (postgresOrderRead ? await postgresOrderRead.listOrders() : readJson(ORDERS_FILE)).map(publicOrder);
  const rows = orders.map((order) => `
    <tr>
      <td>${excelCell(order.orderNumber)}</td>
      <td>${excelCell(order.id)}</td>
      <td>${excelCell(order.createdAt)}</td>
      <td>${excelCell(order.name)}</td>
      <td>${excelCell(order.phone)}</td>
      <td>${excelCell(order.address)}</td>
      <td>${excelCell(order.paymentType === "karta" ? "Karta" : "Naqd")}</td>
      <td>${excelCell(normalizeOrderStatus(order.status))}</td>
      <td>${excelCell(order.subtotal)}</td>
      <td>${excelCell(order.discountAmount)}</td>
      <td>${excelCell(order.total)}</td>
      <td>${excelCell(order.promoCode)}</td>
      <td>${excelCell(orderItemsText(order.items))}</td>
    </tr>
  `).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1">
    <thead><tr><th>Buyurtma raqami</th><th>Ichki ID</th><th>Sana</th><th>Mijoz</th><th>Telefon</th><th>Manzil</th><th>To'lov turi</th><th>Holat</th><th>Oraliq summa</th><th>Chegirma</th><th>Jami</th><th>Promokod</th><th>Mahsulotlar</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></body></html>`;

  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=buyurtmalar.xls");
  res.send(Buffer.from("\ufeff" + html, "utf8"));
  } catch (error) { next(error); }
});

async function findOrderForTracking(orderNumberValue) {
  const orderNumber = sanitizeText(orderNumberValue, 40).toUpperCase();
  if (!/^DOD-ORD-\d{4,}$/.test(orderNumber)) return null;
  return postgresOrderRead ? postgresOrderRead.findByNumber(orderNumber) : readJson(ORDERS_FILE).find(item => String(item.orderNumber || '').toUpperCase() === orderNumber) || null;
}

function trackingSummary(order) {
  return {
    orderNumber: order.orderNumber,
    status: normalizeOrderStatusKey(order.status),
    statusLabel: normalizeOrderStatus(order.status),
    paymentStatus: order.paymentStatus || 'pending',
    paymentDeadline: order.paymentDeadline || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || order.createdAt,
  };
}

app.get("/api/orders/track", trackingLimiter, async (req, res, next) => {
  try { const order = await findOrderForTracking(req.query.orderNumber || req.query.number);

  if (!order) {
    return res.status(404).json({ message: "Buyurtma topilmadi" });
  }

  res.json(trackingSummary(order)); } catch (error) { next(error); }
});

app.post("/api/orders/track", trackingLimiter, async (req, res, next) => {
  try { const order = await findOrderForTracking(req.body.orderNumber || req.body.number);

  if (!order) {
    return res.status(404).json({ message: "Buyurtma topilmadi" });
  }

  res.json({ success: true, order: trackingSummary(order) }); } catch (error) { next(error); }
});

app.post('/api/orders/track/secure', trackingLimiter, async (req, res, next) => {
  try { const order = await findOrderForTracking(req.body.orderNumber || req.body.number);
  const provided = String(req.body.trackingToken || '');
  if (!order || !order.guestTrackingTokenHash || provided.length < 32) return res.status(404).json({ message: 'Buyurtma topilmadi yoki kuzatuv kaliti noto‘g‘ri.' });
  const actual = createHash('sha256').update(provided).digest();
  const expected = Buffer.from(order.guestTrackingTokenHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(404).json({ message: 'Buyurtma topilmadi yoki kuzatuv kaliti noto‘g‘ri.' });
  res.json({ success: true, order: { ...trackingSummary(order), items: (order.items || []).map(item => ({ name: item.name, sku: item.sku || null, qty: item.qty, price: item.price })) } });
  } catch (error) { next(error); }
});

// Persist both records together during a request; roll back inventory if order storage fails.
function saveOrderAndStock(orders, products, previousProducts) {
  writeJson(PRODUCTS_FILE, products);
  try { writeJson(ORDERS_FILE, orders); }
  catch (error) { writeJson(PRODUCTS_FILE, previousProducts); throw error; }
}

function restoreStock(order, products) {
  if (order.legacyStockRestored || (order.stockRestored && !managedReservations(order).length)) return products;
  // New orders have an exact reservation ledger. Legacy orders used the first line only.
  const explicit = (Array.isArray(order.stockReservations) ? order.stockReservations : [])
    .filter(item => Number(item.inventoryVersion || 0) !== 1);
  const reservations = explicit.length ? explicit : products.flatMap(product => {
    if (isInventoryManaged(product)) return [];
    const item = (order.items || []).find(row => String(row.productId) === String(product.id));
    if (!item || (item.inventoryMode || product._inventoryMode || 'standard') !== 'standard' ||
        product.stock == null || product.stock === '' || Number(product.stock) >= 999) return [];
    return [{ productId: product.id, qty: item.qty }];
  });
  const quantities = new Map(reservations.map(item => [String(item.productId), item.qty]));
  return products.map(product => !isInventoryManaged(product) && quantities.has(String(product.id))
    ? { ...product, stock: Number(product.stock || 0) + quantities.get(String(product.id)) } : product);
}

async function changeOrder(req, res, next, target, payment = false) {
  try {
    if (postgresOrders) {
      const rawReason = req.body.reason ?? req.body.adjustmentReason ?? '';
      if (typeof rawReason !== 'string' || rawReason.length > 500 || (target === OrderStatus.REJECTED && !rawReason.trim())) {
        return res.status(400).json({ success: false, error: 'Rad etish sababi 1–500 belgidan iborat bo‘lishi kerak.' });
      }
      try {
        await postgresOrders.transitionOrder(req.params.id, target, { reason: rawReason.trim(),
          actor: req.user.id || req.user.userId || req.user.username, collectPayment: payment });
        return res.json({ success: true, order: publicOrder(await postgresOrderRead.findById(req.params.id)) });
      } catch (error) {
        if (error.code === 'ORDER_NOT_FOUND') return res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
        if (['INVALID_TRANSITION','PAYMENT_REQUIRED','PROVIDER_VERIFICATION_REQUIRED','REJECTION_REASON_REQUIRED'].includes(error.code)) {
          return res.status(409).json({ success: false, code: error.code, error: error.message });
        }
        throw error;
      }
    }
    await withIdentifierLock(DATA_DIR, async () => {
      const orders = readJson(ORDERS_FILE);
      const products = readJson(PRODUCTS_FILE);
      const index = orders.findIndex(order => String(order.id) === String(req.params.id));
      if (index < 0) return res.status(404).json({ success: false, error: 'Order not found' });
      const stored = orders[index];
      const status = normalizeOrderStatusKey(stored.status);
      const order = { ...stored, status: status === 'new' ? OrderStatus.PENDING_CONFIRMATION : status,
        stockReservations: Array.isArray(stored.stockReservations) ? stored.stockReservations.map(item => ({ ...item })) : stored.stockReservations,
        statusHistory: stored.statusHistory && stored.statusHistory.length ? stored.statusHistory : [{ status: stored.status, changedBy: 'system', changedAt: stored.createdAt, reason: 'Existing order before audited transition' }] };
      const rawReason = req.body.reason ?? req.body.adjustmentReason ?? '';
      if (typeof rawReason !== 'string' || rawReason.length > 500 ||
          (target === OrderStatus.REJECTED && !rawReason.trim())) {
        return res.status(400).json({ success: false, error: 'A rejection reason of 1-500 characters is required; notes must be strings of at most 500 characters.' });
      }
      const reason = rawReason.trim();
      const actor = req.user.id || req.user.userId || req.user.username;
      if (target === OrderStatus.REJECTED && order.status === OrderStatus.REJECTED) {
        return res.status(409).json({ success: false, error: 'Order already rejected' });
      }
      if (payment && order.paymentType === 'karta' && order.paymentStatus !== 'collected') {
        return res.status(409).json({ success: false, code: 'PROVIDER_VERIFICATION_REQUIRED',
          error: "Onlayn to'lovni faqat to'lov provayderi tasdiqlashi mumkin." });
      }

      let result;
      if (payment) result = recordPaymentCollection(order, actor, {});
      else if (target === OrderStatus.CONFIRMED) result = confirmOrder(order, reason, actor);
      else if (target === OrderStatus.REJECTED && order.status === OrderStatus.PENDING_CONFIRMATION) result = rejectOrder(order, reason, actor);
      else result = updateOrderStatus(order, target, actor, reason || 'Status updated by admin');
      if (!result.success) return res.status(409).json({ success: false, error: result.error });

      let updatedProducts = products;
      if (target === OrderStatus.CONFIRMED || payment) {
        updatedProducts = commitOrderInventory(result.order, updatedProducts, actor).updatedProducts;
      }
      if ([OrderStatus.REJECTED, OrderStatus.CANCELLED].includes(target) && order.status !== target) {
        const managed = restoreOrderInventory(result.order, updatedProducts,
          reason || (target === OrderStatus.REJECTED ? 'Buyurtma rad etildi' : 'Buyurtma bekor qilindi'), actor);
        updatedProducts = managed.updatedProducts;
        if (!managedReservations(order).length) {
          updatedProducts = restoreStock(order, updatedProducts);
          result.order.legacyStockRestored = true;
          result.order.stockRestored = true;
        }
      }
      orders[index] = result.order;
      saveOrderAndStock(orders, updatedProducts, products);
      res.json({ success: true, order: publicOrder(orders[index]) });
    });
  } catch (error) { next(error); }
}

app.patch('/api/orders/:id/status', verifyAdmin, (req, res, next) => {
  const status = getOrderStatusKey(req.body.status);
  if (!status || status === 'new') return res.status(400).json({ error: 'Invalid order status' });
  return changeOrder(req, res, next, status);
});
app.patch('/api/orders/:id/confirm', verifyAdmin, (req, res, next) => changeOrder(req, res, next, OrderStatus.CONFIRMED));
app.patch('/api/orders/:id/reject', verifyAdmin, (req, res, next) => changeOrder(req, res, next, OrderStatus.REJECTED));
app.patch('/api/orders/:id/payment', verifyAdmin, (req, res, next) => changeOrder(req, res, next, OrderStatus.PRODUCTION, true));
app.get('/api/orders/:id/receipt', verifyAdmin, async (req, res, next) => {
  try { const order = postgresOrderRead ? await postgresOrderRead.findById(req.params.id) : readJson(ORDERS_FILE).find(order => String(order.id) === String(req.params.id));
  const relative = order && String(order.paymentScreenshot || '');
  if (!relative) return res.sendStatus(404);
  const stored = await objectStorage.openPrivate(relative);
  if (!stored) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', stored.contentType || 'application/octet-stream');
  if (Number.isFinite(stored.contentLength)) res.setHeader('Content-Length', String(stored.contentLength));
  stored.body.on('error', next);
  stored.body.pipe(res); } catch (error) { next(error); }
});

app.delete("/api/orders/:id", verifyAdmin, async (req, res, next) => {
  try {
    if (postgresOrders) {
      const result = await postgresOrders.deleteOrder(req.params.id);
      if (!result.found) return res.status(404).json({ message: 'Buyurtma topilmadi' });
      if (!result.deleted) return res.status(409).json({ message: "Ombor tarixi bog‘langan buyurtmani o‘chirib bo‘lmaydi." });
      return res.json({ success: true });
    }
    await withIdentifierLock(DATA_DIR, async () => {
      const orders = readJson(ORDERS_FILE);
      const index = orders.findIndex((order) => String(order.id) === String(req.params.id));
      if (index < 0) return res.status(404).json({ message: "Buyurtma topilmadi" });
      const activeReservation = managedReservations(orders[index]).some(item => item.state !== 'restored');
      if (activeReservation) {
        return res.status(409).json({ message: "Ombor qoldig'i bog'langan buyurtmani avval belgilangan tartibda bekor qiling." });
      }
      orders.splice(index, 1);
      writeJson(ORDERS_FILE, orders);
      res.json({ success: true });
    });
  } catch (error) { next(error); }
});

const orderUpload = guardedUpload(upload.single("paymentScreenshot"));

function checkoutOrderPayload(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: order.total,
    paymentDeadline: order.paymentDeadline,
    createdAt: order.createdAt,
  };
}

app.post("/api/orders", orderUpload, async (req, res, next) => {
  try {
    const operation = async () => {
      const orders = postgresOrderRead ? [] : readJson(ORDERS_FILE);
      const products = postgresCatalog ? await postgresCatalog.listProducts() : readJson(PRODUCTS_FILE);
  const submissionToken = req.body.submissionToken;
  if (submissionToken !== undefined && (typeof submissionToken !== 'string' || !/^[\w-]{16,100}$/.test(submissionToken))) {
    return res.status(400).json({ error: 'Invalid submission token' });
  }
  if (postgresOrderRead && submissionToken) {
    const existing = await postgresOrderRead.findBySubmissionToken(submissionToken);
    if (existing) return res.status(201).json({ success: true, order: checkoutOrderPayload(existing) });
  }
      const baseOrder = await buildOrderFromRequest(req, products);
  const existingOrder = !postgresOrderRead && submissionToken && orders.find(order => order.submissionToken === submissionToken && order.phone === baseOrder.phone);
      if (existingOrder) return res.status(201).json({ success: true, order: checkoutOrderPayload(existingOrder) });

  // ── Validation ─────────────────────────────────────────────────────────────
  const validationErrors = [];

  // Validate customer info
  if (!baseOrder.name || baseOrder.name.length === 0) {
    validationErrors.push({ field: "name", message: "Customer name is required" });
  } else if (baseOrder.name.length > 100) {
    validationErrors.push({ field: "name", message: "Customer name must be 1-100 characters" });
  }

  const phoneStr = String(baseOrder.phone || "").replace(/\s/g, "");
  const phoneOk = /^\+998\d{9}$/.test(phoneStr);
  if (!phoneOk) {
    validationErrors.push({ field: "phone", message: "Invalid phone format. Use +998XXXXXXXXX" });
  }

  if (!baseOrder.address || baseOrder.address.length < 5) {
    validationErrors.push({ field: "address", message: "Address must be 5-500 characters" });
  } else if (baseOrder.address.length > 500) {
    validationErrors.push({ field: "address", message: "Address must be 5-500 characters" });
  }

  if (!baseOrder.items || baseOrder.items.length === 0) {
    validationErrors.push({ field: "items", message: "Order must contain at least 1 item" });
  }

  // Validate items and check inventory
  const itemErrors = [];
  let hasMadeToOrder = false;
  const quantities = new Map();

  for (let i = 0; i < baseOrder.items.length; i++) {
    const item = baseOrder.items[i];
    const product = products.find((p) => String(p.id) === String(item.productId));

    if (!product) {
      itemErrors.push({ 
        field: `items[${i}].productId`, 
        message: `Product ${item.productId} not found or inactive` 
      });
      continue;
    }

    // Check quantity range
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 999) {
      itemErrors.push({ 
        field: `items[${i}].qty`, 
        message: "Quantity must be between 1 and 999" 
      });
      continue;
    }

    // Validate stock for standard products only
    const requestedQty = (quantities.get(String(product.id)) || 0) + item.qty;
    quantities.set(String(product.id), requestedQty);
    const validation = validateProductStock(product, requestedQty);
    if (!validation.valid) {
      itemErrors.push({ 
        field: `items[${i}].qty`, 
        message: validation.error 
      });
    }

    // Validate color/size match product variants if defined
    if (product.colors && product.colors.length > 0 && item.color && !productRules.options(product.colors, 'color').includes(item.color)) {
      itemErrors.push({ 
        field: `items[${i}].color`, 
        message: `Color "${item.color}" not available for this product` 
      });
    }

    if (product.sizes && product.sizes.length > 0 && item.size && !productRules.options(product.sizes, 'size').includes(item.size)) {
      itemErrors.push({ 
        field: `items[${i}].size`, 
        message: `Size "${item.size}" not available for this product` 
      });
    }

    // Track if any item is made-to-order
    if ((product._inventoryMode || "standard") === "made-to-order") {
      hasMadeToOrder = true;
    }
  }

  // Validate promo code if provided
  if (baseOrder.promoCode) {
    const promo = await findPromocode(baseOrder.promoCode);
    if (!promo) {
      validationErrors.push({ 
        field: "promoCode", 
        message: `Promo code "${baseOrder.promoCode}" not found or expired` 
      });
    }
  }

  if (validationErrors.length > 0 || itemErrors.length > 0) {
    return res.status(400).json({
      success: false,
      error: "Validation failed",
      errors: [...validationErrors, ...itemErrors]
    });
  }

  if (!(baseOrder.total > 0)) {
    return res.status(400).json({
      success: false,
      error: "Validation failed",
      errors: [{ field: "total", message: "Order total must be positive" }]
    });
  }

  // ── Create extended order ──────────────────────────────────────────────────
      const extendedOrder = initializeOrderWithExtendedSchema(baseOrder, hasMadeToOrder);
      extendedOrder.customerId = req.session && req.session.customerId ? req.session.customerId : null;
      const guestTrackingToken = extendedOrder.customerId ? null : randomBytes(32).toString('base64url');
      extendedOrder.guestTrackingTokenHash = guestTrackingToken ? createHash('sha256').update(guestTrackingToken).digest('hex') : null;
      if (postgresOrders) {
        extendedOrder.submissionToken = submissionToken || `server-${randomUUID()}`;
        const placed = await postgresOrders.placeOrder({ ...extendedOrder, legacyPayload: extendedOrder,
          statusReason: 'Mijoz buyurtma yaratdi' });
        const stored = await postgresOrderRead.findById(placed.orderId);
        if (placed.created) req.commitUploadedFiles();
        return res.status(201).json({ success: true, order: { ...checkoutOrderPayload(stored),
          ...(guestTrackingToken && placed.created ? { trackingToken: guestTrackingToken,
            trackingUrl: `/track-order.html?orderNumber=${encodeURIComponent(stored.orderNumber)}&token=${encodeURIComponent(guestTrackingToken)}` } : {}) },
          message: hasMadeToOrder ? 'Buyurtma yaratildi. Administrator tasdig‘i kutilmoqda.' : 'Buyurtma yaratildi. To‘lov tasdig‘i kutilmoqda.' });
      }
      const counters = readCounters(IDENTIFIERS_FILE, products, orders);
      extendedOrder.orderNumber = allocateOrderNumber(counters, orders);
      // Persist the allocation before the order. If order storage fails, the
      // number remains consumed and therefore can never be reused.
      writeCounters(IDENTIFIERS_FILE, counters);

  extendedOrder.submissionToken = submissionToken || null;
  extendedOrder.stockReservations = [];
  extendedOrder.stockCommitted = false;
  let updatedProducts = products;
  const managedResult = reserveOrderInventory(extendedOrder, baseOrder.items, products);
  extendedOrder.stockReservations.push(...managedResult.reservations);
  updatedProducts = managedResult.updatedProducts.map(product => {
    const qty = quantities.get(String(product.id));
    if (!qty || isInventoryManaged(product) || (product._inventoryMode || 'standard') !== 'standard' ||
        product.stock == null || product.stock === '') return product;
    extendedOrder.stockReservations.push({ productId: product.id, qty, inventoryVersion: 0 });
    return { ...product, stock: Number(product.stock) - qty };
  });
  orders.unshift(extendedOrder);
  saveOrderAndStock(orders, updatedProducts, products);

  // Telegram notification (fault-isolated)
  Promise.resolve().then(() => notifyOrder(extendedOrder)).catch(() => {});

  // ── Return success response ────────────────────────────────────────────────
      req.commitUploadedFiles();
      res.status(201).json({
        success: true,
        order: { ...checkoutOrderPayload(extendedOrder),
          ...(guestTrackingToken ? { trackingToken: guestTrackingToken,
            trackingUrl: `/track-order.html?orderNumber=${encodeURIComponent(extendedOrder.orderNumber)}&token=${encodeURIComponent(guestTrackingToken)}` } : {}) },
        message: hasMadeToOrder
          ? "Order created. Awaiting admin confirmation. Payment required after approval."
          : "Order created successfully. Payment confirmation pending."
      });
    };
    if (postgresOrders) await operation();
    else await withIdentifierLock(DATA_DIR, operation);
  } catch (error) {
    if (['INSUFFICIENT_STOCK','INVENTORY_NOT_FOUND','PROMO_NOT_AVAILABLE','INVALID_TOTAL'].includes(error.code)) {
      return res.status(400).json({ success: false, error: error.message });
    }
    next(error);
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── 404 handler (after all routes) ───────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Route not found" });
  }
  res.sendStatus(404);
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (!err) return next();

  // Client/upload errors (multer, etc.) -> 400 with a message
  if (err instanceof multer.MulterError || err.status === 400) {
    const message = err.message || "Xatolik yuz berdi";
    if (req.path.startsWith("/api")) return res.status(400).json({ error: message });
    return res.status(400).send(message);
  }

  if (postgresPool) console.error('[ERROR]', { code: err.code || 'DATABASE_OR_ROUTE_ERROR', path: req.path });
  else console.error("[ERROR]", err);
  const isProd = process.env.NODE_ENV === "production";
  const body = isProd
    ? { error: "Internal server error" }
    : { error: "Internal server error", detail: err.message };
  res.status(err.status || 500).json(body);
});

// ── Unhandled promise rejections — log, never crash ──────────────────────────
if (require.main === module) process.on("unhandledRejection", (reason) => {
  console.error("[UnhandledRejection]", reason);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
function attachGracefulShutdown(server) {
  let shuttingDown = false;
  const handler = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SHUTDOWN] ${signal} received, closing server...`);
    const force = setTimeout(() => {
      console.error("[SHUTDOWN] Forced close after 10s");
      process.exit(0);
    }, 10000);
    force.unref();
    server.close(async () => {
      if (postgresPool) {
        try { await postgresPool.end(); } catch { /* shutdown continues */ }
      }
      console.log("[SHUTDOWN] All connections closed");
      process.exit(0);
    });
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
}

// Railway routes traffic only to its injected PORT. Port fallback remains a
// local-development convenience and is disabled in production.
const candidatePorts = process.env.NODE_ENV === 'production'
  ? [PORT]
  : [...new Set([PORT, PORT + 1, 3001, 5003, 5004, 8080])];

function startServer(index = 0) {
  if (index >= candidatePorts.length) {
    console.error("All candidate ports are busy. Free a port or set PORT in .env.");
    process.exit(1);
  }

  const port = candidatePorts[index];
  const server = app.listen(port, HOST, () => {
    console.log(`Server listening on ${HOST}:${port}`);
    // Local JSON/file development may repair its cache. R2/PostgreSQL
    // production never writes generated gallery files to the app filesystem.
    if (!postgresPool && objectStorage.backend === 'local') {
      cacheBuyoGalleryImages({ projectRoot: __dirname, maxImages: 3, skipCompleted: true })
        .then((result) => {
          if (result.downloaded || result.changed) console.log('[gallery-cache] startup sync:', result);
        })
        .catch((err) => console.warn('[gallery-cache] startup sync skipped:', err.message));
    }
  });

  attachGracefulShutdown(server);

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`Port ${port} band, keyingi portga o'tish...`);
      startServer(index + 1);
    } else {
      throw err;
    }
  });
}

if (require.main === module) startServer();
return app;
}

module.exports = { createApp };
if (require.main === module) createApp();
