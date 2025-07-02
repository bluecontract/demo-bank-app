import nx from '@nx/eslint-plugin';
import jsoncParser from 'jsonc-eslint-parser';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      '**/test-output',
      '.nx/cache/**',
    ],
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', 'scripts/**/*.js'], // Workspace scripts have more relaxed boundaries
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^\\.\\./apps/.*$', // Workspace scripts can import from apps for documentation/tooling
          ],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['package.json'], // Root package.json - single source of truth for versions
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          checkMissingDependencies: true,
          checkObsoleteDependencies: true,
          checkVersionMismatches: true,
          ignoredDependencies: [],
          ignoredFiles: ['*.config.{js,ts,mjs}', '**/*.config.{js,ts,mjs}'],
          includeTransitiveDependencies: false,
        },
      ],
    },
  },
  {
    files: ['apps/**/package.json', 'libs/**/package.json'], // All project package.json files
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          checkMissingDependencies: true, // Must declare dependencies they actually use
          checkObsoleteDependencies: true, // Remove unused dependencies
          checkVersionMismatches: true, // Versions must match root package.json
          ignoredDependencies: ['vitest'], // Test framework comes from root devDependencies
          ignoredFiles: ['*.config.{js,ts,mjs}', '**/*.config.{js,ts,mjs}'],
          includeTransitiveDependencies: false,
        },
      ],
    },
  },
];
