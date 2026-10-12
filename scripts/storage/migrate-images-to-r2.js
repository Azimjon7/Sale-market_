const fs = require('fs');
const path = require('path');
const { buildStorageInventory } = require('../../utils/storageInventory');
const { createObjectStorage } = require('../../utils/objectStorage');

const CONFIRMATION = 'UPLOAD_DODOLA_IMAGES_TO_R2';

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

async function migrate({ projectRoot, apply = false, confirmation = '', env = process.env, objectStorage, concurrency, onProgress } = {}) {
  const root = path.resolve(projectRoot || path.join(__dirname, '..', '..'));
  const inventory = await buildStorageInventory(root);
  const conflicts = inventory.files.filter(item => item.classification === 'conflict');
  if (conflicts.length) throw new Error(`Bir xil fayl public mahsulot va maxfiy to‘lov dalili sifatida ishlatilgan: ${conflicts.length}`);
  const eligible = inventory.files.filter(item => ['public-product', 'public-static', 'private-payment'].includes(item.classification));
  const excluded = inventory.files.filter(item => !eligible.includes(item));
  const plan = {
    mode: apply ? 'apply' : 'dry-run', createdAtUtc: new Date().toISOString(),
    source: inventory.summary,
    upload: { files: eligible.length, bytes: eligible.reduce((sum, item) => sum + item.sizeBytes, 0) },
    excluded: excluded.reduce((counts, item) => { counts[item.classification] = (counts[item.classification] || 0) + 1; return counts; }, {}),
  };
  if (!apply) return { ...plan, message: 'Dry-run: R2 ga hech qanday fayl yuborilmadi.' };
  if (confirmation !== CONFIRMATION || env.R2_MIGRATION_APPROVED !== 'yes') {
    throw new Error(`Apply bloklandi. --confirm=${CONFIRMATION} va R2_MIGRATION_APPROVED=yes talab qilinadi.`);
  }
  const storage = objectStorage || createObjectStorage({ env: { ...env, FILE_STORAGE_BACKEND: 'r2' }, projectRoot: root });
  if (storage.backend !== 'r2') throw new Error('Migratsiya faqat R2 backend bilan bajariladi.');
  const stateFile = path.join(root, '.local-storage-migrations', 'r2-migration-state.json');
  let state = { version: 1, objects: {} };
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) {}
  const results = { uploaded: 0, skipped: 0, failed: 0, bytesUploaded: 0 };
  const workerCount = Math.max(1, Math.min(32, Number(concurrency || env.R2_MIGRATION_CONCURRENCY || 12) || 12));
  let cursor = 0;
  let completed = 0;
  let firstError = null;
  async function processItem(item) {
    const visibility = item.classification === 'private-payment' ? 'private' : 'public';
    try {
      const checkpoint = state.objects[item.reference];
      if (checkpoint && !checkpoint.failedAtUtc && checkpoint.sha256 === item.sha256 &&
          checkpoint.sizeBytes === item.sizeBytes && checkpoint.visibility === visibility) {
        results.skipped += 1;
        return;
      }
      const existing = await storage.head(item.reference, { visibility });
      if (existing) {
        if (existing.size !== item.sizeBytes || existing.sha256 !== item.sha256) {
          throw new Error('R2 da shu kalit bilan boshqa tarkibli obyekt mavjud');
        }
        results.skipped += 1;
      } else {
        const verified = await storage.putFile(item.reference, item.absolutePath, { visibility, sha256: item.sha256 });
        if (!verified || verified.size !== item.sizeBytes || verified.sha256 !== item.sha256) throw new Error('Yuklangan obyekt checksum tekshiruvidan o‘tmadi');
        results.uploaded += 1;
        results.bytesUploaded += item.sizeBytes;
      }
      state.objects[item.reference] = { sha256: item.sha256, sizeBytes: item.sizeBytes, visibility, verifiedAtUtc: new Date().toISOString() };
      atomicWrite(stateFile, state);
    } catch (error) {
      results.failed += 1;
      state.objects[item.reference] = { sha256: item.sha256, sizeBytes: item.sizeBytes, visibility, failedAtUtc: new Date().toISOString(), error: error.code || error.name || 'UPLOAD_FAILED' };
      atomicWrite(stateFile, state);
      if (!firstError) firstError = error;
    } finally {
      completed += 1;
      if (onProgress && (completed === eligible.length || completed % 100 === 0)) onProgress({ completed, total: eligible.length, ...results });
    }
  }
  async function worker() {
    while (!firstError) {
      const index = cursor;
      cursor += 1;
      if (index >= eligible.length) return;
      await processItem(eligible[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workerCount, eligible.length) }, () => worker()));
  if (firstError) throw firstError;
  return { ...plan, results, concurrency: workerCount, stateFile, message: 'Mahalliy fayllar o‘chirilmadi.' };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const confirmationArg = process.argv.find(arg => arg.startsWith('--confirm='));
  const result = await migrate({ apply, confirmation: confirmationArg ? confirmationArg.slice(10) : '',
    onProgress: progress => console.error(`[r2-migration] ${progress.completed}/${progress.total}; uploaded=${progress.uploaded}; skipped=${progress.skipped}; failed=${progress.failed}`) });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { migrate, CONFIRMATION };
