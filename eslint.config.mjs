// ESLint 10 flat configuration. Uses only packages already pinned in package-lock.json.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'catalog/**', // exported data and media, not source
      'client/pwa/**', // static assets and service worker
      'server/test-fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['client/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules },
  },
  {
    files: ['server/**/*.{ts,js,mjs}', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'client/tests/**/*.{ts,tsx}', '*.config.{js,mjs,ts}', 'client/*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
