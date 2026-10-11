import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    rules: {
      // Chrome listeners have positional arguments that may go unused.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['extension/background.js', 'extension/grid-executor.js'],
    languageOptions: {
      globals: {
        ...Object.fromEntries(
          Object.keys(globals.browser).map((name) => [name, 'off']),
        ),
        ...globals.serviceworker,
        chrome: 'readonly',
      },
    },
  },
];
