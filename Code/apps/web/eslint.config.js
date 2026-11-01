import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // react-hooks v7 "recommended" bundles React Compiler diagnostics; adopting those is a
      // separate refactor, so keep the v5-equivalent hook rules enforced for now.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/lib/resource-reconciliation.ts', 'src/hooks/use-list-presence.ts', 'src/hooks/use-resource-reconciliation.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/api-client', '**/session-data-cache'],
          message: 'Shared reconciliation and presence primitives must not own feature transport or cache persistence.',
        }],
      }],
    },
  },
  {
    // Node-run build/util scripts use Node globals
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/'],
  },
);
