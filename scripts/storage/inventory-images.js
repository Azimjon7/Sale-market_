const fs = require('fs');
const path = require('path');
const { buildStorageInventory } = require('../../utils/storageInventory');

async function main() {
  const root = path.join(__dirname, '..', '..');
  const inventory = await buildStorageInventory(root);
  const outputArg = process.argv.find(arg => arg.startsWith('--output='));
  const output = outputArg ? path.resolve(outputArg.slice(9)) : path.join(root, '.local-storage-migrations', 'latest-image-inventory.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(inventory, null, 2));
  console.log(JSON.stringify({ output, ...inventory.summary }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
