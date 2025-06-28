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
    ],
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
    files: ['**/package.json'],
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
          ignoredDependencies: ['vite'],
          ignoredFiles: ['*.config.{js,ts,mjs}', '**/*.config.{js,ts,mjs}'],
          includeTransitiveDependencies: false,
        },
      ],
    },
  },
  {
    files: ['apps/bank-lambda/package.json'],
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
          ignoredDependencies: ['vite', 'vitest'],
          ignoredFiles: ['*.config.{js,ts,mjs}', '**/*.config.{js,ts,mjs}'],
          includeTransitiveDependencies: false,
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
