'use strict';
const path = require('path');
const { loadSource, validateSource, summarize } = require('./sourceSnapshot');

function runDryRun(dataDir = path.join(__dirname, '..', '..', 'data')) {
  const source = loadSource(dataDir), errors = validateSource(source), summary = summarize(source);
  return { ok: errors.length === 0, mode: 'dry-run', connectedToDatabase: false, summary, errors };
}

if (require.main === module) {
  const report = runDryRun(process.argv.find(arg => arg.startsWith('--data-dir='))?.slice(11));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
module.exports = { runDryRun };
