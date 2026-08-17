// Flat config for dsh-plugin-longmem.
// Goals (in order):
//  1. Match the TypeScript settings in tsconfig.json (no
//     re-evaluation, just borrowing the parser/typed-lint rules).
//  2. Warn on style — never auto-block — so the first pass after
//     install is a "fix-on-save" run, not a gate.
//  3. Hand formatting off to Prettier, which has the last word.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'

export default [
  {
    ignores: [
      'node_modules/',
      'lib/',
      'dist/',
      'coverage/',
      '.vitest-cache/',
      '*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    plugins: {
      prettier: prettierPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Prettier owns formatting. ESLint reports its findings; the
      // --fix run applies them. We don't fight the formatter.
      'prettier/prettier': 'warn',
      // tseslint recommended has a few we want quiet for a plugin
      // library: every export is part of the public API by design.
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow leading underscore on private fields (e.g. _disposables
      // in cordis internals referenced in comments).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Some files cast `as unknown as Foo` to work around upstream
      // types missing event names; intentional, not a lint trap.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  prettier,
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Tests are allowed to know things about the internal shape
      // they're verifying.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
]
