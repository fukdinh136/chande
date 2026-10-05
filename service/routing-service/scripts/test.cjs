const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mode = process.argv[2];
const modes = ['unit', 'contract', 'integration', 'e2e'];
if (mode !== 'all' && mode !== 'cross-service' && !modes.includes(mode)) throw new Error('Unknown test suite');
function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? collect(file) : file.endsWith('.test.js') ? [file] : [];
  });
}
const files = (mode === 'all' ? modes : [mode]).flatMap(suite => collect(path.join('.test-dist', 'test', suite)));
if (!files.length) throw new Error('No tests found in requested suite');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
