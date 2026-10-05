const ts = require('typescript-eslint');
module.exports = ts.config(
  { ignores: ['dist/**', '.test-dist/**', 'node_modules/**'] },
  ...ts.configs.recommended,
  { files: ['**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' }, rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
