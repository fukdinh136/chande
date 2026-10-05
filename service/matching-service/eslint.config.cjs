const ts = require('typescript-eslint');
module.exports = ts.config({ ignores: ['dist/**', '.test-dist/**', 'node_modules/**'] }, ...ts.configs.recommended, { files: ['**/*.ts'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } });
