import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import parser from '@typescript-eslint/parser';
import browserSecurity from 'eslint-plugin-browser-security';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        process: 'readonly',
        window: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'browser-security': browserSecurity,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Security rules
      'browser-security/no-eval': 'error',
      'browser-security/no-innerhtml': 'error',
      'browser-security/require-postmessage-origin-check': 'error',
      'browser-security/no-postmessage-wildcard-origin': 'error',
      'browser-security/no-sensitive-localstorage': 'error',
      'browser-security/no-sensitive-indexeddb': 'error',

    },
  },
  {
    ignores: ['dist', 'node_modules', '*.config.ts', '*.config.js'],
  },
];
