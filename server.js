require("dotenv").config();
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const { readJSON, writeJSON } = require("./utils/jsonStore");
const { sendOrderNotification } = require("./utils/telegram");
const { cacheBuyoGalleryImages } = require("./utils/cacheBuyoGalleryImages");
const verifyAdminToken = require("./middleware/verifyAdminToken");

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

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.warn(
      "[WARN] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Telegram notifications are disabled (orders still work)."
    );
  }
}
validateEnv();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = Number(process.env.PORT) || 3000;

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const CATEGORIES_FILE = path.join(DATA_DIR, "categories.json");
const PROMOCODES_FILE = path.join(DATA_DIR, "promocodes.json");
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");

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
const ORDER_STATUS_KEYS = ["new", "confirmed", "shipped", "delivered", "cancelled"];
const ORDER_STATUS_LABELS = {
  new: "Qabul qilindi",
  confirmed: "Tayyorlanmoqda",
  shipped: "Yetkazilmoqda",
  delivered: "Yetkazildi",
  cancelled: "Bekor qilindi",
};
const ORDER_STATUS_ALIASES = {
  yangi: "new",
  "qabul qilindi": "new",
  new: "new",
  tasdiqlandi: "confirmed",
  tayyorlanmoqda: "confirmed",
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

const corsOptions =
  process.env.NODE_ENV === "production" && process.env.ALLOWED_ORIGIN
    ? { origin: process.env.ALLOWED_ORIGIN }
    : { origin: true };
app.use(cors(corsOptions));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(express.static(__dirname));

// Rate limiter: max 5 admin-login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
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

function getOrderStatusKey(status) {
  const text = String(status || "").trim();
  if (!text) return null;
  if (ORDER_STATUS_KEYS.includes(text)) return text;
  return ORDER_STATUS_ALIASES[text.toLowerCase()] || null;
}

function normalizeOrderStatusKey(status) {
  return getOrderStatusKey(status) || "new";
}

function normalizeOrderStatus(status) {
  return ORDER_STATUS_LABELS[normalizeOrderStatusKey(status)];
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

function findPromocode(code) {
  const normalized = sanitizeText(code, 40).toUpperCase();
  if (!normalized) return null;
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
  return {
    ...product,
    stock,
    label: normalizeProductLabel(product.label || product.badge),
    badge: normalizeProductLabel(product.label || product.badge),
  };
}

function publicOrder(order) {
  return {
    id: order.id,
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
    status: normalizeOrderStatus(order.status),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || order.createdAt,
  };
}

function customerOrder(order) {
  return {
    id: order.id,
    name: order.name,
    phone: order.phone,
    address: order.address,
    total: toNumber(order.total, 0),
    paymentType: order.paymentType || "naqd",
    status: normalizeOrderStatusKey(order.status),
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
      if (f && f.filename && allowed.has(String(f.fieldname || ""))) {
        list.push(`uploads/${f.filename}`);
      }
    });
    return list;
  }

  Object.keys(files).forEach((key) => {
    const group = files[key];
    if (!allowed.has(String(key || ""))) return;
    if (!Array.isArray(group)) return;
    group.forEach((f) => {
      if (f && f.filename) list.push(`uploads/${f.filename}`);
    });
  });

  return list;
}

function getProductImages(product) {
  const images = Array.isArray(product.images) ? [...new Set(product.images.filter(Boolean))] : [];
  if (images.length) return images;
  return product.image ? [product.image] : [];
}

function deleteUploadFiles(paths) {
  paths.forEach((img) => {
    if (!String(img).startsWith("uploads/")) return;
    const filePath = path.join(__dirname, img);
    if (!fs.existsSync(filePath)) return;
    try {
      fs.unlinkSync(filePath);
    } catch {}
  });
}

ensureDir(UPLOADS_DIR);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `prd_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE, files: 12 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
    if (!String(file.mimetype || "").startsWith("image/") || !allowedExt.has(ext)) {
      return cb(new Error("Faqat rasm fayllarini yuklash mumkin"));
    }
    cb(null, true);
  },
});
const productUpload = upload.any();

function normalizeProduct(body, uploadedFiles) {
  const existingImages = parseList(body.existingImages || body.existingImage);
  const uploadedPaths = collectUploadedPaths(uploadedFiles);
  // Keep newly uploaded images first so home/shop immediately reflect updates.
  const images = [...new Set([...uploadedPaths, ...existingImages].filter(Boolean))];

  return {
    id: body.id || `prd_${Date.now()}`,
    name: sanitizeText(body.name, 160),
    price: Math.max(0, toNumber(body.price, 0)),
    oldPrice: Math.max(0, toNumber(body.oldPrice, 0)),
    category: sanitizeText(body.category, 120),
    desc: sanitizeMultiline(body.desc || body.description, 2000),
    image: images[0] || "",
    images,
    sizes: sanitizeText(body.sizes, 300),
    colors: sanitizeText(body.colors, 300),
    stock: Math.max(0, Math.floor(toNumber(body.stock, 999))),
    label: normalizeProductLabel(body.label || body.badge),
    createdAt: body.createdAt || new Date().toISOString(),
  };
}
app.post("/api/admin/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};

  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
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

function sortProducts(products, sort) {
  const cmp = (a, b) => String(a.id).localeCompare(String(b.id));
  switch (sort) {
    case "price-low":
      return [...products].sort((a, b) => (a.price - b.price) || cmp(a, b));
    case "price-high":
      return [...products].sort((a, b) => (b.price - a.price) || cmp(a, b));
    case "most-reviewed": {
      const reviews = readJson(REVIEWS_FILE, []);
      const counts = {};
      (Array.isArray(reviews) ? reviews : []).forEach((r) => {
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

app.get("/api/products", (req, res) => {
  let all = loadProductsCached();

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
        String(p.desc || p.description || "").toLowerCase().includes(lc)
    );
  }

  const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
  const hasSort = req.query.sort !== undefined;

  if (hasSort) {
    all = sortProducts(all, String(req.query.sort));
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

  if (!hasSort) all = sortProducts(all, "newest");

  const total = all.length;
  const pages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const products = all.slice(start, start + limit);

  res.json({ products, meta: { total, page, limit, pages } });
});

app.get("/api/categories", (req, res) => {
  res.json(readCategories());
});

app.post("/api/categories", verifyAdmin, (req, res) => {
  const name = sanitizeText(req.body.name || req.body.category, 120);

  if (!name) {
    return res.status(400).json({ message: "Kategoriya nomi kiritilmadi" });
  }

  const categories = readCategories();
  const exists = categories.some((item) => item.toLowerCase() === name.toLowerCase());

  if (!exists) {
    categories.push(name);
    writeJson(CATEGORIES_FILE, categories);
  }

  res.json({ success: true, categories });
});

app.delete("/api/categories/:name", verifyAdmin, (req, res) => {
  const target = sanitizeText(req.params.name, 120);
  const categories = readCategories();
  const filtered = categories.filter((item) => item.toLowerCase() !== target.toLowerCase());

  if (filtered.length === categories.length) {
    return res.status(404).json({ message: "Kategoriya topilmadi" });
  }

  writeJson(CATEGORIES_FILE, filtered);
  res.json({ success: true, categories: filtered });
});

app.put("/api/categories/:name", verifyAdmin, (req, res) => {
  const target = sanitizeText(req.params.name, 120);
  const nextName = sanitizeText(req.body.name || req.body.category, 120);

  if (!target || !nextName) {
    return res.status(400).json({ message: "Kategoriya nomi kiritilmadi" });
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
});

app.get("/api/products/:id", (req, res) => {
  const products = readJson(PRODUCTS_FILE);
  const product = products.find((p) => String(p.id) === String(req.params.id));

  if (!product) {
    return res.status(404).json({ message: "Mahsulot topilmadi" });
  }

  res.json(productWithDefaults(product));
});

app.post("/api/products", verifyAdmin, productUpload, (req, res) => {
  const products = readJson(PRODUCTS_FILE);
  const product = normalizeProduct(req.body, req.files);

  if (!product.name || !product.category || !product.desc || !product.images.length || !product.price) {
    return res.status(400).json({ message: "Majburiy maydonlar toldirilmagan" });
  }

  products.unshift(product);
  writeJson(PRODUCTS_FILE, products);

  res.json({ success: true, product });
});

app.put("/api/products/:id", verifyAdmin, productUpload, (req, res) => {
  const products = readJson(PRODUCTS_FILE);
  const index = products.findIndex((p) => String(p.id) === String(req.params.id));

  if (index === -1) {
    return res.status(404).json({ message: "Mahsulot topilmadi" });
  }

  const current = products[index];
  const currentImages = getProductImages(current);
  const uploadedPaths = collectUploadedPaths(req.files);
  const requestedExisting = parseList(req.body.existingImages || req.body.existingImage);
  const updated = normalizeProduct(
    {
      ...current,
      ...req.body,
      id: current.id,
      createdAt: current.createdAt,
      // Respect client-side per-image removals; if new files are uploaded, replace with new set.
      existingImages: uploadedPaths.length
        ? ""
        : (requestedExisting.length ? requestedExisting.join(",") : currentImages.join(",")),
    },
    req.files
  );

  // Remove files that are no longer referenced after update.
  const removedImages = currentImages.filter((img) => !updated.images.includes(img));
  deleteUploadFiles(removedImages);

  products[index] = updated;
  writeJson(PRODUCTS_FILE, products);

  res.json({ success: true, product: updated });
});

app.delete("/api/products/:id", verifyAdmin, (req, res) => {
  const products = readJson(PRODUCTS_FILE);
  const target = products.find((p) => String(p.id) === String(req.params.id));

  const imagePaths = target ? getProductImages(target) : [];
  deleteUploadFiles(imagePaths);

  const filtered = products.filter((p) => String(p.id) !== String(req.params.id));
  writeJson(PRODUCTS_FILE, filtered);

  res.json({ success: true });
});

app.get("/api/promocodes", verifyAdmin, (req, res) => {
  res.json(readPromocodes());
});

app.post("/api/promocodes", verifyAdmin, (req, res) => {
  const code = sanitizeText(req.body.code, 40).toUpperCase();
  const discountPercent = clampNumber(req.body.discountPercent, 1, 90, 1);

  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    return res.status(400).json({ message: "Promokod kamida 3 ta belgi bo'lishi kerak" });
  }

  const promocodes = readPromocodes();
  const index = promocodes.findIndex((promo) => promo.code === code);
  const promo = { code, discountPercent, createdAt: index === -1 ? new Date().toISOString() : promocodes[index].createdAt };

  if (index === -1) promocodes.push(promo);
  else promocodes[index] = promo;

  writeJson(PROMOCODES_FILE, promocodes);
  res.json({ success: true, promocodes });
});

app.delete("/api/promocodes/:code", verifyAdmin, (req, res) => {
  const code = sanitizeText(req.params.code, 40).toUpperCase();
  const promocodes = readPromocodes();
  const filtered = promocodes.filter((promo) => promo.code !== code);

  if (filtered.length === promocodes.length) {
    return res.status(404).json({ message: "Promokod topilmadi" });
  }

  writeJson(PROMOCODES_FILE, filtered);
  res.json({ success: true, promocodes: filtered });
});

app.post("/api/promocodes/apply", (req, res) => {
  const promo = findPromocode(req.body.code);
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
});

app.get("/api/reviews", (req, res) => {
  const productId = String(req.query.productId || "").trim();
  const reviews = readJson(REVIEWS_FILE);
  const list = (Array.isArray(reviews) ? reviews : []).filter((review) => {
    return !productId || String(review.productId) === productId;
  });
  res.json(list);
});

app.post("/api/reviews", (req, res) => {
  const productId = sanitizeText(req.body.productId, 80);
  const name = sanitizeText(req.body.name, 80);
  const rating = clampNumber(req.body.rating, 1, 5, 5);
  const review = sanitizeMultiline(req.body.review, 800);

  if (!productId || !name || !review) {
    return res.status(400).json({ message: "Sharh uchun ma'lumot yetarli emas" });
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
});

app.delete("/api/reviews/:id", verifyAdmin, (req, res) => {
  const reviews = readJson(REVIEWS_FILE);
  const filtered = reviews.filter((review) => String(review.id) !== String(req.params.id));
  if (filtered.length === reviews.length) {
    return res.status(404).json({ message: "Sharh topilmadi" });
  }
  writeJson(REVIEWS_FILE, filtered);
  res.json({ success: true });
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

function buildOrderFromRequest(req, products) {
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

  const enrichedItems = parsedItems.map((item) => {
    const productId = String(item.productId || item.id || "").trim();
    const product = products.find((p) => String(p.id) === productId);
    const qty = Math.max(1, Math.floor(toNumber(item.qty, 1)));
    const price = Math.max(0, toNumber(product ? product.price : item.price, 0));
    return {
      productId,
      name: sanitizeText((product && product.name) || item.name || "Mahsulot", 180),
      size: sanitizeText(item.size, 80),
      color: sanitizeText(item.color, 80),
      qty,
      price,
      lineTotal: price * qty,
    };
  }).filter((item) => item.productId && item.qty > 0);

  const subtotal = enrichedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const promo = findPromocode(req.body.promoCode || req.body.promo);
  const discountAmount = promo ? Math.floor((subtotal * promo.discountPercent) / 100) : 0;

  return {
    id: `ord_${Date.now()}`,
    name: sanitizeText(req.body.name, 120),
    phone: sanitizeText(req.body.phone, 60),
    address: sanitizeText(req.body.address, 260),
    note: sanitizeMultiline(req.body.note, 600),
    subtotal,
    discountAmount,
    promoCode: promo ? promo.code : "",
    total: Math.max(0, subtotal - discountAmount),
    items: enrichedItems,
    paymentType: paymentType === "karta" ? "karta" : "naqd",
    paymentScreenshot: req.file ? `uploads/${req.file.filename}` : "",
    status: "new",
    createdAt: new Date().toISOString(),
  };
}

app.get("/api/orders", verifyAdmin, (req, res) => {
  const orders = readJson(ORDERS_FILE);
  res.json(orders.map(publicOrder));
});

app.get("/api/orders/export", verifyAdmin, (req, res) => {
  const orders = readJson(ORDERS_FILE).map(publicOrder);
  const rows = orders.map((order) => `
    <tr>
      <td>${excelCell(order.id)}</td>
      <td>${excelCell(order.createdAt)}</td>
      <td>${excelCell(order.name)}</td>
      <td>${excelCell(order.phone)}</td>
      <td>${excelCell(order.address)}</td>
      <td>${excelCell(order.paymentType === "karta" ? "Karta" : "Naqd")}</td>
      <td>${excelCell(order.status)}</td>
      <td>${excelCell(order.subtotal)}</td>
      <td>${excelCell(order.discountAmount)}</td>
      <td>${excelCell(order.total)}</td>
      <td>${excelCell(order.promoCode)}</td>
      <td>${excelCell(orderItemsText(order.items))}</td>
    </tr>
  `).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1">
    <thead><tr><th>Buyurtma ID</th><th>Sana</th><th>Mijoz</th><th>Telefon</th><th>Manzil</th><th>To'lov turi</th><th>Status</th><th>Oraliq summa</th><th>Chegirma</th><th>Jami</th><th>Promokod</th><th>Mahsulotlar</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></body></html>`;

  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=buyurtmalar.xls");
  res.send(Buffer.from("\ufeff" + html, "utf8"));
});

function findOrderForTracking(orderIdValue, phoneValue) {
  const orderId = sanitizeText(orderIdValue, 80);
  const phone = normalizePhone(phoneValue);
  if (!orderId || !phone) return null;
  const orders = readJson(ORDERS_FILE);
  return orders.find((item) => {
    const itemPhone = normalizePhone(item.phone);
    return String(item.id) === orderId && itemPhone === phone;
  });
}

app.get("/api/orders/track", (req, res) => {
  const order = findOrderForTracking(req.query.orderId || req.query.id, req.query.phone);

  if (!order) {
    return res.status(404).json({ message: "Buyurtma topilmadi" });
  }

  res.json(customerOrder(order));
});

app.post("/api/orders/track", (req, res) => {
  const order = findOrderForTracking(req.body.orderId || req.body.id, req.body.phone);

  if (!order) {
    return res.status(404).json({ message: "Buyurtma topilmadi" });
  }

  res.json({ success: true, order: customerOrder(order) });
});

app.patch("/api/orders/:id/status", verifyAdmin, (req, res) => {
  const orders = readJson(ORDERS_FILE);
  const index = orders.findIndex((order) => String(order.id) === String(req.params.id));

  if (index === -1) {
    return res.status(404).json({ message: "Buyurtma topilmadi" });
  }

  const status = getOrderStatusKey(req.body.status);
  if (!status) {
    return res.status(400).json({ message: "Status noto'g'ri" });
  }

  orders[index] = {
    ...orders[index],
    status,
    updatedAt: new Date().toISOString(),
  };
  writeJson(ORDERS_FILE, orders);

  res.json({ success: true, order: publicOrder(orders[index]) });
});

app.delete("/api/orders/:id", verifyAdmin, (req, res) => {
  const orders = readJson(ORDERS_FILE);
  const filtered = orders.filter((order) => String(order.id) !== String(req.params.id));

  if (filtered.length === orders.length) {
    return res.status(404).json({ message: "Buyurtma topilmadi" });
  }

  writeJson(ORDERS_FILE, filtered);
  res.json({ success: true });
});

const orderUpload = upload.single("paymentScreenshot");

app.post("/api/orders", orderUpload, (req, res) => {
  const orders = readJson(ORDERS_FILE);
  const products = readJson(PRODUCTS_FILE);
  const order = buildOrderFromRequest(req, products);

  if (order.paymentType === "karta" && !order.paymentScreenshot) {
    return res.status(400).json({ message: "Karta to'lovi uchun skrinshot majburiy" });
  }

  // ── Structured validation ──────────────────────────────────────────────────
  const details = {};
  if (!order.name) details.customerName = "Ism kiritilmagan";
  else if (order.name.length > 100) details.customerName = "Ism 100 belgidan oshmasligi kerak";

  const phoneDigits = String(order.phone || "").replace(/\D/g, "");
  // Accept +998XXXXXXXXX (9 digits after country code)
  const phoneOk = /^998\d{9}$/.test(phoneDigits) || /^\+998\d{9}$/.test(String(order.phone || "").replace(/\s/g, ""));
  if (!phoneOk) details.phone = "Telefon raqam +998XXXXXXXXX formatida bo'lishi kerak";

  if (!order.address) details.address = "Manzil kiritilmagan";
  else if (order.address.length < 10) details.address = "Manzil kamida 10 ta belgi bo'lishi kerak";

  if (!order.items.length) details.products = "Mahsulotlar ro'yxati bo'sh";

  if (Object.keys(details).length) {
    return res.status(400).json({ error: "Validation failed", details });
  }

  if (!(order.total > 0)) {
    return res.status(400).json({ error: "Validation failed", details: { total: "Order total must be positive" } });
  }

  for (const item of order.items) {
    const product = products.find((p) => String(p.id) === String(item.productId));
    if (!product) {
      return res.status(404).json({ message: "Mahsulot topilmadi" });
    }

    if (product.stock !== undefined && product.stock !== null && product.stock !== "") {
      const stock = Math.max(0, Math.floor(toNumber(product.stock, 0)));
      if (stock < 999 && stock < item.qty) {
        return res.status(400).json({ message: `${product.name || "Mahsulot"} sotuvda yetarli emas` });
      }
    }
  }

  const updatedProducts = products.map((product) => {
    const item = order.items.find((row) => String(row.productId) === String(product.id));
    if (!item || product.stock === undefined || product.stock === null || product.stock === "") return product;
    const currentStock = Math.max(0, Math.floor(toNumber(product.stock, 0)));
    return {
      ...product,
      stock: currentStock >= 999 ? 999 : Math.max(0, currentStock - item.qty),
    };
  });

  orders.unshift(order);
  try {
    writeJson(ORDERS_FILE, orders);
  } catch (err) {
    console.error("[orders] Write failed:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }

  // Best-effort stock update — never fail the order if this write fails.
  try {
    writeJson(PRODUCTS_FILE, updatedProducts);
  } catch (err) {
    console.error("[orders] Stock update failed (non-fatal):", err.message);
  }

  // Telegram is fault-isolated: missing config or failures never block the order.
  sendOrderNotification(order).catch(() => {});

  res.json({
    success: true,
    orderId: order.id,
    id: order.id,
    status: order.status,
    phone: order.phone,
    message: "Buyurtmangiz qabul qilindi. Buyurtma raqamingizni saqlab qo'ying.",
    order: publicOrder(order),
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── 404 handler (after all routes) ───────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Route not found" });
  }
  next();
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

  console.error("[ERROR]", err);
  const isProd = process.env.NODE_ENV === "production";
  const body = isProd
    ? { error: "Internal server error" }
    : { error: "Internal server error", detail: err.message };
  res.status(err.status || 500).json(body);
});

// ── Unhandled promise rejections — log, never crash ──────────────────────────
process.on("unhandledRejection", (reason) => {
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
    server.close(() => {
      console.log("[SHUTDOWN] All connections closed");
      process.exit(0);
    });
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
}

const candidatePorts = [...new Set([PORT, PORT + 1, 3001, 5003, 5004, 8080])];

function startServer(index = 0) {
  if (index >= candidatePorts.length) {
    console.error("All candidate ports are busy. Free a port or set PORT in .env.");
    process.exit(1);
  }

  const port = candidatePorts[index];
  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    // Best-effort fallback: Render/npm postinstall normally caches BUYO gallery
    // images during build. If anything is still missing, retry in background.
    cacheBuyoGalleryImages({ projectRoot: __dirname, maxImages: 3, skipCompleted: true })
      .then((result) => {
        if (result.downloaded || result.changed) console.log('[gallery-cache] startup sync:', result);
      })
      .catch((err) => console.warn('[gallery-cache] startup sync skipped:', err.message));
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

startServer();
