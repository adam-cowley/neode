import eslint from '@eslint/js'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import vitest from '@vitest/eslint-plugin'
import { defineConfig } from 'eslint/config'
import importX from 'eslint-plugin-import-x'
import unicorn from 'eslint-plugin-unicorn'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      'dist',
      'coverage',
      '.changeset',
      'eslint.config.ts',
      '*.config.ts',
      'bench/**',
      'examples/**',
      'scripts/**',
      // Re-enabled in Phase 4 when type tests land
      'test/**',
    ],
  },

  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  unicorn.configs.recommended,
  comments.recommended,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
    rules: {
      // Type safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/prefer-readonly-parameter-types': 'off', // too noisy for an ORM

      // Async correctness
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
      '@typescript-eslint/require-await': 'error',

      // Public API hygiene
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true },
      ],
      '@typescript-eslint/no-deprecated': 'error',

      // General strictness
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-console': ['error', { allow: ['warn'] }],
      'no-param-reassign': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Use a const object and a union type instead of enums.',
        },
      ],

      // Imports
      'import-x/no-cycle': 'error',
      'import-x/no-default-export': 'error',
      'import-x/no-extraneous-dependencies': 'error',
      'import-x/no-duplicates': 'error',

      // Agent guardrails: every suppression must be explained and targeted
      '@eslint-community/eslint-comments/require-description': 'error',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',

      // Unicorn rules that fight the ORM/TS style
      'unicorn/no-null': 'off', // Neo4j returns null
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      // unicorn 79 preset ships a bare 'error' value that eslint 9.39's
      // stricter rule-schema validation rejects; set explicit options here
      'unicorn/logical-assignment-operators': ['error', 'always'],
    },
  },

  // The Relate client is not published to npm: it is loaded dynamically
  // from a sibling checkout (or RELATE_CLIENT_PATH), which needs require()
  {
    files: ['src/driver/relate.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': 'off',
    },
  },

  // Public entry: the default export is the documented package API
  // (import Neode from '@neode/ogm')
  {
    files: ['src/index.ts'],
    rules: {
      'import-x/no-default-export': 'off',
    },
  },

  // Tests: keep type safety, relax ergonomics only
  {
    files: ['**/*.test.ts', '**/*.test-d.ts', 'test/**/*.ts'],
    extends: [vitest.configs.recommended],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      'vitest/expect-expect': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
    },
  },

  // Root config files that can't be type-checked
  {
    files: ['**/*.js', '**/*.mjs', '**/*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
