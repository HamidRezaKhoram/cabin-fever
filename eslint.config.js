// ESLint (flat config) with typescript-eslint's type-aware rules on our checked JS.
// Runs in scripts/test-all.sh and the pre-commit hook: `npm run lint` must report 0 problems.
'use strict';
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

const TYPED = {
  // Promises must be awaited or explicitly ignored with `void` — unhandled ones hide bugs.
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
  '@typescript-eslint/no-for-in-array': 'error',
  '@typescript-eslint/no-implied-eval': 'error',
  '@typescript-eslint/only-throw-error': 'error',
  '@typescript-eslint/restrict-plus-operands': ['error', { allowNumberAndString: true, allowAny: true }],
};
const COMMON = {
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  eqeqeq: ['error', 'smart'],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
  // Node has a global `crypto`; `const crypto = require('crypto')` is still the clearer import.
  'no-redeclare': ['error', { builtinGlobals: false }],
};

module.exports = [
  { ignores: ['node_modules/**', 'test/ui/.shots/**', 'test/.music-fixture/**', 'public/socket.io/**', 'content-src/**', 'dist/**', 'vendor/**', 'tts/**'] },
  js.configs.recommended,
  // Type-aware: server + games (+ the bot CLI) through tsconfig.json.
  {
    files: ['server.js', 'core/**/*.js', 'games/**/*.js', 'tools/**/*.js'],
    ignores: ['tools/build-pages.js'],
    languageOptions: {
      sourceType: 'commonjs', globals: globals.node,
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: __dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...COMMON, ...TYPED },
  },
  // Type-aware: browser pages (TV and phone share files, so both projects are listed).
  {
    files: ['public/**/*.js'],
    ignores: ['public/sw.js', 'public/tts-worker.js'],
    languageOptions: {
      sourceType: 'script', globals: { ...globals.browser, io: 'readonly' },
      parser: tseslint.parser,
      parserOptions: { project: ['./tsconfig.host.json', './tsconfig.play.json'], tsconfigRootDir: __dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...COMMON, ...TYPED },
  },
  // The GitHub Pages build: browser code that bundles the game server (tsconfig.web.json).
  {
    files: ['web/**/*.js', 'tools/build-pages.js'],
    ignores: ['web/sw-template.js'],
    languageOptions: {
      sourceType: 'commonjs', globals: { ...globals.browser, ...globals.node },
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.web.json', tsconfigRootDir: __dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...COMMON, ...TYPED },
  },
  // The Pages service worker template (the build fills in the file lists).
  {
    files: ['web/sw-template.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker, __FILES__: 'readonly', __MEDIA__: 'readonly', __PHONE__: 'readonly' } },
    rules: COMMON,
  },
  // The narrator's voice worker: an ES module in a worker scope (loads the Kokoro build at runtime).
  {
    files: ['public/tts-worker.js'],
    languageOptions: { sourceType: 'module', globals: globals.worker },
    rules: COMMON,
  },
  // The service worker runs in its own scope (no DOM, no page tsconfig).
  {
    files: ['public/sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
    rules: COMMON,
  },
  // Tests and config: plain rules (not in a tsconfig project).
  {
    files: ['test/**/*.js', 'eslint.config.js'],
    // `Rumpus` is used inside page.evaluate() callbacks (they run in the browser).
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser, Rumpus: 'readonly' } },
    rules: COMMON,
  },
];
