// ESLint flat config (audit E-06). `npm run lint` runs inside `npm run check`.
// Browser globals for the client, Node globals for the API and scripts; React 18 JSX runtime.
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: [
      'dist/**', 'node_modules/**', 'public/slab/vendor/**', 'public/**/*.js', 'training/**', 'data/**',
      'staging/**', 'models/**', 'scripts/unused/**', 'scripts/tag-dataset/**', '**/*.min.js',
      'SlabSense Slab Engraving Studio/**', 'Mapping Defects/**', 'backup-api/**', 'scripts/studio-app.extracted.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021, __APP_VERSION__: 'readonly' },
    },
    settings: { react: { version: '18.3' } },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ...react.configs.flat['jsx-runtime'],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh, 'jsx-a11y': jsxA11y },
    rules: {
      // hooks: the two classic rules; the React-Compiler rules in v7 (set-state-in-effect, refs,
      // purity, static-components, immutability) are advisory and off until the App.jsx split
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react/prop-types': 'off',
      'react/no-unknown-property': ['error', { ignore: ['jsx'] }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // click-to-dismiss overlays and the capture editor use pointer handlers on divs by design
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
    },
  },
  {
    files: ['src/**/*.test.js', 'src/**/*.spec.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['api/**/*.js', 'scripts/**/*.{js,mjs,cjs}', 'tests/**/*.{js,mjs}', '*.config.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',   // import attributes (`with { type: 'json' }`) in api/_lib
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['scripts/harness/clip-parity/**/*.js'],   // browser harness page served by the dev server
    languageOptions: { globals: { ...globals.browser } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
