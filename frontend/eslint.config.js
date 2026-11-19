// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // .next/ is build output of the former Next.js frontend that may linger in old checkouts.
  { ignores: ['dist/**', 'coverage/**', '.next/**'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  reactRefresh.configs.vite,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@metaflow/backend', '@metaflow/backend/*', '**/backend/**'],
              message:
                'The frontend must never import backend code. Put shared contracts in @metaflow/shared.',
            },
            {
              group: ['@metaflow/shared/*'],
              message: 'Import from the @metaflow/shared entry point only.',
            },
          ],
        },
      ],
    },
  },
  {
    // shadcn/ui primitives export variant helpers next to components by design.
    files: ['src/components/ui/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
