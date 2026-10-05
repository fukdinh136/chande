const { rmSync } = require('node:fs');
const { resolve } = require('node:path');
rmSync(resolve(__dirname, '..', '.test-dist'), { recursive: true, force: true });
