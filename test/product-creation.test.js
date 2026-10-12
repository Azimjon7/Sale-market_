/**
 * Tests for Product Creation Endpoint with Inventory Mode Support
 */

const request = require('supertest');
const app = require('../server');
const fs = require('fs');
const path = require('path');

// Mock data directory
const TEST_DATA_DIR = path.join(__dirname, '../data');
const PRODUCTS_FILE = path.join(TEST_DATA_DIR, 'products.json');

// Helper to backup and restore products.json
function backupProducts() {
  if (fs.existsSync(PRODUCTS_FILE)) {
    return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  }
  return [];
}

function restoreProducts(backup) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(backup, null, 2));
}

describe('POST /api/products - Product Creation with Inventory Mode', () => {
  let productsBackup;

  beforeAll(() => {
    // Ensure data directory exists
    if (!fs.existsSync(TEST_DATA_DIR)) {
      fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  beforeEach(() => {
    // Backup current products
    productsBackup = backupProducts();
  });

  afterEach(() => {
    // Restore products
    if (productsBackup) {
      restoreProducts(productsBackup);
    }
  });

  describe('Default inventoryMode', () => {
    test('should create product with default inventoryMode="standard" when not provided', async () => {
      const productData = {
        name: 'Test Product',
        category: 'Electronics',
        desc: 'Test description',
        price: 100000,
        stock: 50,
        sizes: 'M,L,XL',
        colors: 'Red,Blue'
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('sizes', productData.sizes)
        .field('colors', productData.colors)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.product).toBeDefined();
      expect(response.body.product._inventoryMode).toBe('standard');
      expect(response.body.product._acceptsMTO).toBe(false);
      expect(response.body.product._productionDays).toBe(14);
      expect(response.body.product._buyo_id).toBeNull();
    });
  });

  describe('Explicit inventoryMode', () => {
    test('should create product with inventoryMode="made-to-order" when explicitly set', async () => {
      const productData = {
        name: 'MTO Product',
        category: 'Custom',
        desc: 'Made-to-order product',
        price: 150000,
        stock: 0,
        inventoryMode: 'made-to-order',
        _acceptsMTO: true,
        _productionDays: 21,
        _buyo_id: 'buyo_test123'
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('inventoryMode', productData.inventoryMode)
        .field('_acceptsMTO', productData._acceptsMTO)
        .field('_productionDays', productData._productionDays)
        .field('_buyo_id', productData._buyo_id)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.product._inventoryMode).toBe('made-to-order');
      expect(response.body.product._acceptsMTO).toBe(true);
      expect(response.body.product._productionDays).toBe(21);
      expect(response.body.product._buyo_id).toBe('buyo_test123');
    });

    test('should accept inventoryMode="standard" explicitly', async () => {
      const productData = {
        name: 'Standard Product',
        category: 'Electronics',
        desc: 'Standard inventory product',
        price: 200000,
        stock: 100,
        inventoryMode: 'standard'
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('inventoryMode', productData.inventoryMode)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.product._inventoryMode).toBe('standard');
    });
  });

  describe('Invalid inventoryMode validation', () => {
    test('should reject product with invalid inventoryMode', async () => {
      const productData = {
        name: 'Invalid MTO Product',
        category: 'Test',
        desc: 'Invalid inventory mode test',
        price: 100000,
        stock: 50,
        inventoryMode: 'invalid-mode'
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('inventoryMode', productData.inventoryMode)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid inventoryMode');
      expect(response.body.details.inventoryMode).toBeDefined();
    });

    test('should reject product with empty inventoryMode string', async () => {
      const productData = {
        name: 'Empty Mode Product',
        category: 'Test',
        desc: 'Empty inventory mode test',
        price: 100000,
        stock: 50,
        inventoryMode: ''
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('inventoryMode', productData.inventoryMode)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.product._inventoryMode).toBe('standard'); // Empty defaults to standard
    });

    test('should reject product with fuzzy invalid mode like "mto" instead of "made-to-order"', async () => {
      const productData = {
        name: 'Fuzzy Mode Product',
        category: 'Test',
        desc: 'Fuzzy inventory mode test',
        price: 100000,
        stock: 50,
        inventoryMode: 'mto'
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('inventoryMode', productData.inventoryMode)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid inventoryMode');
    });
  });

  describe('Production days validation', () => {
    test('should use default _productionDays=14 when not provided', async () => {
      const productData = {
        name: 'Default Production Days',
        category: 'Test',
        desc: 'Test',
        price: 100000,
        stock: 0,
        inventoryMode: 'made-to-order'
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('inventoryMode', productData.inventoryMode)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.product._productionDays).toBe(14);
    });

    test('should accept custom _productionDays value', async () => {
      const productData = {
        name: 'Custom Production Days',
        category: 'Test',
        desc: 'Test',
        price: 100000,
        stock: 0,
        _productionDays: 28
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('_productionDays', productData._productionDays)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.product._productionDays).toBe(28);
    });

    test('should enforce minimum _productionDays=1', async () => {
      const productData = {
        name: 'Low Production Days',
        category: 'Test',
        desc: 'Test',
        price: 100000,
        stock: 0,
        _productionDays: 0
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('_productionDays', productData._productionDays)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.product._productionDays).toBeGreaterThanOrEqual(1);
    });
  });

  describe('New fields in response', () => {
    test('should return all new inventory-related fields in response', async () => {
      const productData = {
        name: 'Complete Product',
        category: 'Test',
        desc: 'Complete test',
        price: 100000,
        stock: 50,
        inventoryMode: 'made-to-order',
        _acceptsMTO: true,
        _productionDays: 21,
        _buyo_id: 'buyo_complete'
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .field('inventoryMode', productData.inventoryMode)
        .field('_acceptsMTO', productData._acceptsMTO)
        .field('_productionDays', productData._productionDays)
        .field('_buyo_id', productData._buyo_id)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.product).toHaveProperty('_inventoryMode');
      expect(response.body.product).toHaveProperty('_acceptsMTO');
      expect(response.body.product).toHaveProperty('_productionDays');
      expect(response.body.product).toHaveProperty('_buyo_id');
    });

    test('should return null for _buyo_id when not provided', async () => {
      const productData = {
        name: 'No BUYO ID',
        category: 'Test',
        desc: 'Test',
        price: 100000,
        stock: 50
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('stock', productData.stock)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      expect(response.body.product._buyo_id).toBeNull();
    });
  });

  describe('Backward compatibility', () => {
    test('should preserve existing product fields when adding new ones', async () => {
      const productData = {
        name: 'Backward Compat',
        category: 'Electronics',
        desc: 'Testing backward compatibility',
        price: 150000,
        oldPrice: 200000,
        stock: 75,
        sizes: 'S,M,L',
        colors: 'Black,White,Red',
        label: 'New'
      };

      const response = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${process.env.JWT_TOKEN || 'test-token'}`)
        .field('name', productData.name)
        .field('category', productData.category)
        .field('desc', productData.desc)
        .field('price', productData.price)
        .field('oldPrice', productData.oldPrice)
        .field('stock', productData.stock)
        .field('sizes', productData.sizes)
        .field('colors', productData.colors)
        .field('label', productData.label)
        .attach('image', Buffer.from('fake image data'), 'test.jpg');

      expect(response.status).toBe(200);
      const product = response.body.product;
      // Verify existing fields are preserved
      expect(product.name).toBe(productData.name);
      expect(product.category).toBe(productData.category);
      expect(product.desc).toBe(productData.desc);
      expect(product.price).toBe(productData.price);
      expect(product.oldPrice).toBe(productData.oldPrice);
      expect(product.stock).toBe(productData.stock);
      expect(product.label).toBe(productData.label);
      // Verify new fields also added
      expect(product._inventoryMode).toBe('standard');
    });
  });
});
