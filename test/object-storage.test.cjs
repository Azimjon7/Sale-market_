const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const multer = require('multer');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'object-storage-isolated-secret-at-least-32-characters';
process.env.ADMIN_USERNAME = 'storage-admin';
process.env.ADMIN_PASSWORD = 'storage-password';
const { createApp } = require('../server');
const { createObjectStorage, assertImageBytes, publicUrl } = require('../utils/objectStorage');
const { buildStorageInventory } = require('../utils/storageInventory');
const { publicFiles } = require('../utils/publicFiles');
const { migrate, CONFIRMATION } = require('../scripts/storage/migrate-images-to-r2');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dodola-r2-'));
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'img'), { recursive: true });
  fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'img', 'logo.png'), PNG);
  fs.writeFileSync(path.join(root, 'uploads', 'product.png'), PNG);
  fs.writeFileSync(path.join(root, 'uploads', 'proof.png'), PNG);
  fs.writeFileSync(path.join(root, 'uploads', 'orphan.png'), PNG);
  fs.writeFileSync(path.join(root, 'uploads', 'manifest.json'), '{}');
  fs.writeFileSync(path.join(root, 'data', 'products.json'), JSON.stringify([{ id: 'p1', image: 'uploads/product.png', images: ['uploads/product.png'] }]));
  fs.writeFileSync(path.join(root, 'data', 'orders.json'), JSON.stringify([{ id: 'o1', paymentScreenshot: 'uploads/proof.png' }]));
  return root;
}

test('image inventory classifies public, private, unreferenced, and sidecar files', async t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inventory = await buildStorageInventory(root);
  assert.equal(inventory.summary.allFiles, 5);
  assert.equal(inventory.summary.imageFiles, 4);
  assert.deepEqual(inventory.summary.byClassification['public-static'].files, 1);
  assert.deepEqual(inventory.summary.byClassification['public-product'].files, 1);
  assert.deepEqual(inventory.summary.byClassification['private-payment'].files, 1);
  assert.deepEqual(inventory.summary.byClassification['unreferenced-upload'].files, 1);
  assert.deepEqual(inventory.summary.byClassification.sidecar.files, 1);
  assert.ok(inventory.files.every(item => /^[a-f0-9]{64}$/.test(item.sha256)));
});

test('migration defaults to dry-run and requires two explicit apply gates', async t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dryRun = await migrate({ projectRoot: root });
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.upload.files, 3);
  assert.equal(dryRun.excluded['unreferenced-upload'], 1);
  await assert.rejects(() => migrate({ projectRoot: root, apply: true, confirmation: CONFIRMATION, env: {} }), /Apply bloklandi/);
});

test('migration is checksum verified, resumable, and idempotent', async t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const objects = new Map();
  const storage = {
    backend: 'r2',
    async head(reference, { visibility }) { return objects.get(`${visibility}:${reference}`) || null; },
    async putFile(reference, source, { visibility, sha256 }) {
      const value = { size: fs.statSync(source).size, sha256 };
      objects.set(`${visibility}:${reference}`, value);
      return value;
    },
  };
  const options = { projectRoot: root, apply: true, confirmation: CONFIRMATION, env: { R2_MIGRATION_APPROVED: 'yes' }, objectStorage: storage };
  const first = await migrate(options);
  assert.equal(first.results.uploaded, 3);
  assert.equal(first.results.failed, 0);
  const second = await migrate(options);
  assert.equal(second.results.uploaded, 0);
  assert.equal(second.results.skipped, 3);
  assert.equal(objects.has('private:uploads/proof.png'), true);
});

test('upload storage verifies real image bytes before local persistence', async t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = createObjectStorage({ env: { FILE_STORAGE_BACKEND: 'local' }, projectRoot: root, uploadsDir: path.join(root, 'uploads') });
  const engine = storage.createMulterStorage(multer);
  const save = buffer => new Promise((resolve, reject) => engine._handleFile({}, {
    fieldname: 'imageFile', originalname: 'new.png', mimetype: 'image/png', stream: Readable.from(buffer),
  }, (error, result) => error ? reject(error) : resolve(result)));
  await assert.rejects(() => save(Buffer.from('not an image')), /tarkibi noto‘g‘ri/);
  const saved = await save(PNG);
  assert.equal(saved.storageRef.startsWith('uploads/prd_'), true);
  assert.equal(fs.existsSync(saved.path), true);
  await storage.delete(saved.storageRef);
  assert.equal(fs.existsSync(saved.path), false);
});

test('public URL encoding and image signature checks reject spoofed extensions', () => {
  assert.equal(publicUrl('https://media.example.test/', 'uploads/a b.png'), 'https://media.example.test/uploads/a%20b.png');
  assert.throws(() => assertImageBytes(PNG, 'fake.jpg'), /tarkibi noto‘g‘ri/);
});

test('R2 keeps product uploads public and payment proofs in the private bucket', async () => {
  const calls = [];
  const client = { async send(command) {
    calls.push({ name: command.constructor.name, input: command.input });
    if (command.constructor.name === 'GetObjectCommand') return { Body: Readable.from(PNG), ContentType: 'image/png', ContentLength: PNG.length };
    return {};
  } };
  const env = {
    FILE_STORAGE_BACKEND: 'r2', R2_ACCOUNT_ID: 'account', R2_ACCESS_KEY_ID: 'access', R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET_NAME: 'public-assets', R2_PRIVATE_BUCKET_NAME: 'private-files', R2_PUBLIC_BASE_URL: 'https://media.example.test',
  };
  const storage = createObjectStorage({ env, projectRoot: '.', uploadsDir: 'uploads', s3Client: client });
  const engine = storage.createMulterStorage(multer);
  const save = fieldname => new Promise((resolve, reject) => engine._handleFile({}, {
    fieldname, originalname: 'photo.png', mimetype: 'image/png', stream: Readable.from(PNG),
  }, (error, result) => error ? reject(error) : resolve(result)));
  const product = await save('imageFile');
  const proof = await save('paymentScreenshot');
  assert.match(product.storageRef, /^uploads\//);
  assert.match(proof.storageRef, /^r2-private:\/\/payment-proofs\//);
  assert.equal(calls[0].input.Bucket, 'public-assets');
  assert.equal(calls[1].input.Bucket, 'private-files');
  assert.equal(storage.publicDelivery(product.storageRef).redirect.startsWith('https://media.example.test/uploads/'), true);
  const privateObject = await storage.openPrivate(proof.storageRef);
  assert.equal(privateObject.contentType, 'image/png');
  assert.equal(JSON.stringify(storage.config).includes('secret'), false);
});

test('R2 public delivery redirects only approved static and product references', async t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = express();
  app.use(publicFiles({
    root, uploadsDir: path.join(root, 'uploads'),
    getProducts: () => [{ image: 'uploads/product.png', images: ['uploads/product.png'] }],
    objectStorage: { publicDelivery: reference => ({ redirect: `https://media.example.test/${reference}` }) },
  }));
  app.use((req, res) => res.sendStatus(404));
  await request(app).get('/img/logo.png').expect(302).expect('Location', 'https://media.example.test/img/logo.png');
  await request(app).get('/uploads/product.png').expect(302).expect('Location', 'https://media.example.test/uploads/product.png');
  await request(app).get('/uploads/proof.png').expect(404);
});

test('admin upload validates bytes and shared product files are deleted only after the final reference', async t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const uploadsDir = path.join(root, 'uploads');
  const shared = path.join(uploadsDir, 'shared.png');
  fs.writeFileSync(shared, PNG);
  const base = { name: 'Shared', category: 'Test', desc: 'Fixture', price: 1000, image: 'uploads/shared.png', images: ['uploads/shared.png'], _inventoryMode: 'made-to-order' };
  fs.writeFileSync(path.join(dataDir, 'products.json'), JSON.stringify([{ ...base, id: 'shared-1', sku: 'DOD-0001' }, { ...base, id: 'shared-2', sku: 'DOD-0002' }]));
  for (const [name, value] of Object.entries({ categories: ['Test'], promocodes: [], reviews: [], customers: [], 'auth-tokens': [], 'customer-sessions': {}, 'identifier-counters': { nextSku: 3, nextOrderNumber: 1001 } })) {
    fs.writeFileSync(path.join(dataDir, `${name}.json`), JSON.stringify(value));
  }
  const app = createApp({ dataDir, uploadsDir, notifyOrder: async () => {}, env: { ...process.env, FILE_STORAGE_BACKEND: 'local' } });
  const token = jwt.sign({ username: 'storage-admin', role: 'admin' }, process.env.JWT_SECRET);
  const auth = { Authorization: `Bearer ${token}` };
  const before = new Set(fs.readdirSync(uploadsDir));
  const created = await request(app).post('/api/products').set(auth)
    .field('name', 'Yuklangan mahsulot').field('category', 'Test').field('desc', 'Xavfsiz yuklash testi').field('price', '1500').field('inventoryMode', 'made-to-order')
    .attach('imageFile', PNG, { filename: 'photo.png', contentType: 'image/png' }).expect(200);
  const reference = created.body.product.images[0];
  assert.match(reference, /^uploads\/prd_/);
  assert.deepEqual(fs.readFileSync(path.join(uploadsDir, reference.slice(8))), PNG);
  await request(app).post('/api/products').set(auth)
    .field('name', 'Soxta rasm').field('category', 'Test').field('desc', 'Rad etilishi kerak').field('price', '1500')
    .attach('imageFile', Buffer.from('not png'), { filename: 'spoof.png', contentType: 'image/png' }).expect(400);
  const after = new Set(fs.readdirSync(uploadsDir));
  assert.equal([...after].filter(name => !before.has(name)).length, 1);
  await request(app).delete('/api/products/shared-1').set(auth).expect(200);
  assert.equal(fs.existsSync(shared), true);
  await request(app).delete('/api/products/shared-2').set(auth).expect(200);
  assert.equal(fs.existsSync(shared), false);
});
