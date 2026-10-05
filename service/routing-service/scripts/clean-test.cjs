const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.resolve(root, '.test-dist');
if (path.dirname(target) !== root || path.basename(target) !== '.test-dist') throw new Error('Unsafe test output');
if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Refusing symlink test output');
fs.rmSync(target, { recursive: true, force: true });
