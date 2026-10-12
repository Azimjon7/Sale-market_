const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

function normalizeReference(value) {
  const clean = String(value || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
  if (!clean || clean.includes('..') || clean.split('/').some(part => !part)) return '';
  return clean;
}

function contentTypeFor(reference) {
  return ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  })[path.extname(reference).toLowerCase()] || 'application/octet-stream';
}

function detectedImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp' && /^(avif|avis|mif1)$/i.test(buffer.subarray(8, 12).toString('ascii'))) return 'avif';
  return '';
}

function assertImageBytes(buffer, filename) {
  const detected = detectedImageType(buffer);
  const ext = path.extname(filename || '').toLowerCase();
  const expected = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext.slice(1);
  if (!detected || detected !== expected) throw Object.assign(new Error('Rasm fayli turi yoki tarkibi noto‘g‘ri'), { status: 400 });
  return detected;
}

function safeLocalFile(root, relative) {
  const clean = normalizeReference(relative);
  if (!clean) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, clean);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  try {
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch (_) { return null; }
}

function publicUrl(base, reference) {
  const clean = normalizeReference(reference);
  if (!base || !clean) return '';
  return `${String(base).replace(/\/+$/, '')}/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

function requiredR2Config(env) {
  const accountId = String(env.R2_ACCOUNT_ID || '').trim();
  const endpoint = String(env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).trim();
  const config = {
    endpoint,
    accessKeyId: String(env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(env.R2_SECRET_ACCESS_KEY || '').trim(),
    publicBucket: String(env.R2_BUCKET_NAME || '').trim(),
    privateBucket: String(env.R2_PRIVATE_BUCKET_NAME || env.R2_BUCKET_NAME || '').trim(),
    publicBaseUrl: String(env.R2_PUBLIC_BASE_URL || '').trim(),
  };
  const names = {
    endpoint: 'R2_ENDPOINT yoki R2_ACCOUNT_ID', accessKeyId: 'R2_ACCESS_KEY_ID',
    secretAccessKey: 'R2_SECRET_ACCESS_KEY', publicBucket: 'R2_BUCKET_NAME',
    privateBucket: 'R2_PRIVATE_BUCKET_NAME', publicBaseUrl: 'R2_PUBLIC_BASE_URL',
  };
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => names[key]);
  if (missing.length) throw new Error(`R2 sozlamalari yetishmaydi: ${missing.join(', ')}`);
  return config;
}

function createObjectStorage({ env = process.env, projectRoot, uploadsDir, s3Client } = {}) {
  const backend = String(env.FILE_STORAGE_BACKEND || 'local').trim().toLowerCase();
  if (!['local', 'r2'].includes(backend)) throw new Error('FILE_STORAGE_BACKEND faqat local yoki r2 bo‘lishi mumkin.');
  const root = path.resolve(projectRoot || path.join(__dirname, '..'));
  const localUploads = path.resolve(uploadsDir || path.join(root, 'uploads'));
  let r2 = null;
  let client = null;
  if (backend === 'r2') {
    r2 = requiredR2Config(env);
    client = s3Client || new S3Client({
      region: 'auto', endpoint: r2.endpoint,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    });
  }

  const bucketFor = visibility => visibility === 'private' ? r2.privateBucket : r2.publicBucket;
  const keyFor = reference => normalizeReference(reference.replace(/^r2-private:\/\//, ''));

  return {
    backend,
    config: r2 ? { endpoint: r2.endpoint, publicBucket: r2.publicBucket, privateBucket: r2.privateBucket, publicBaseUrl: r2.publicBaseUrl } : null,
    makeFilename(originalName, prefix = 'prd') {
      const ext = path.extname(originalName || '').toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) throw Object.assign(new Error('Faqat rasm fayllarini yuklash mumkin'), { status: 400 });
      return `${prefix}_${Date.now()}_${randomUUID()}${ext}`;
    },
    createMulterStorage(multer) {
      const owner = this;
      return {
        _handleFile(req, file, cb) {
          const chunks = [];
          file.stream.on('data', chunk => chunks.push(chunk));
          file.stream.once('error', cb);
          file.stream.once('end', async () => {
            try {
              const isPrivate = file.fieldname === 'paymentScreenshot';
              const filename = owner.makeFilename(file.originalname, isPrivate ? 'pay' : 'prd');
              const reference = isPrivate ? `r2-private://payment-proofs/${filename}` : `uploads/${filename}`;
              const key = keyFor(reference);
              const body = Buffer.concat(chunks);
              assertImageBytes(body, filename);
              const sha256 = createHash('sha256').update(body).digest('hex');
              if (backend === 'local') {
                await fs.promises.mkdir(localUploads, { recursive: true });
                const destination = path.join(localUploads, filename);
                await fs.promises.writeFile(destination, body, { flag: 'wx' });
                return cb(null, { filename, path: destination, storageRef: `uploads/${filename}`, visibility: isPrivate ? 'private' : 'public', size: body.length, sha256 });
              }
              await client.send(new PutObjectCommand({
                Bucket: bucketFor(isPrivate ? 'private' : 'public'), Key: key, Body: body,
                ContentType: contentTypeFor(filename), Metadata: { sha256 },
                CacheControl: isPrivate ? 'no-store' : 'public, max-age=31536000, immutable',
              }));
              cb(null, { filename, storageRef: reference, objectKey: key, visibility: isPrivate ? 'private' : 'public', size: body.length, sha256 });
            } catch (error) { cb(error); }
          });
        },
        async _removeFile(req, file, cb) {
          try {
            if (backend === 'local' && file.path) await fs.promises.unlink(file.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
            if (backend === 'r2' && file.objectKey) await client.send(new DeleteObjectCommand({ Bucket: bucketFor(file.visibility), Key: file.objectKey }));
            cb(null);
          } catch (error) { cb(error); }
        },
      };
    },
    publicDelivery(reference) {
      const clean = normalizeReference(reference);
      if (backend !== 'r2' || !clean || !r2.publicBaseUrl) return null;
      return { redirect: publicUrl(r2.publicBaseUrl, clean) };
    },
    async openPrivate(reference) {
      if (backend === 'local') {
        const clean = normalizeReference(String(reference || '').replace(/^uploads\//, ''));
        const file = safeLocalFile(localUploads, clean);
        return file ? { body: fs.createReadStream(file), contentType: contentTypeFor(file), contentLength: fs.statSync(file).size } : null;
      }
      if (!String(reference || '').startsWith('r2-private://') && !String(reference || '').startsWith('uploads/')) return null;
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: r2.privateBucket, Key: keyFor(reference) }));
        return { body: result.Body, contentType: result.ContentType || 'application/octet-stream', contentLength: result.ContentLength };
      } catch (error) {
        if (error && (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404)) return null;
        throw error;
      }
    },
    async delete(reference, { visibility = 'public' } = {}) {
      const isPrivateReference = String(reference || '').startsWith('r2-private://');
      const clean = keyFor(reference);
      if (!clean) return false;
      if (backend === 'local') {
        if (!clean.startsWith('uploads/')) return false;
        const file = safeLocalFile(localUploads, clean.slice(8));
        if (!file) return false;
        await fs.promises.unlink(file);
        return true;
      }
      if (isPrivateReference) visibility = 'private';
      await client.send(new DeleteObjectCommand({ Bucket: bucketFor(visibility), Key: keyFor(reference) }));
      return true;
    },
    async head(reference, { visibility = 'public' } = {}) {
      if (backend === 'local') {
        const clean = normalizeReference(reference);
        const file = clean.startsWith('uploads/') ? safeLocalFile(localUploads, clean.slice(8)) : safeLocalFile(root, clean);
        return file ? { size: fs.statSync(file).size } : null;
      }
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucketFor(visibility), Key: keyFor(reference) }));
        return { size: Number(result.ContentLength || 0), sha256: result.Metadata && result.Metadata.sha256 };
      } catch (error) {
        if (error && (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404)) return null;
        throw error;
      }
    },
    async putFile(reference, sourcePath, { visibility = 'public', sha256 } = {}) {
      if (backend !== 'r2') throw new Error('putFile faqat R2 saqlashida ishlaydi.');
      const key = keyFor(reference);
      if (!key) throw new Error('Noto‘g‘ri obyekt kaliti.');
      const stat = await fs.promises.stat(sourcePath);
      await client.send(new PutObjectCommand({
        Bucket: bucketFor(visibility), Key: key, Body: fs.createReadStream(sourcePath),
        ContentLength: stat.size, ContentType: contentTypeFor(reference),
        Metadata: sha256 ? { sha256 } : undefined,
        CacheControl: visibility === 'private' ? 'no-store' : 'public, max-age=31536000, immutable',
      }));
      return this.head(reference, { visibility });
    },
    _client: client,
  };
}

module.exports = { createObjectStorage, normalizeReference, contentTypeFor, detectedImageType, assertImageBytes, safeLocalFile, requiredR2Config, publicUrl };
