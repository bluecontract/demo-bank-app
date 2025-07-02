import baseConfig from '../../eslint.config.mjs';
import playwright from 'eslint-plugin-playwright';

export default [
  ...baseConfig,
  {
    ignores: [
      'out-tsc/**/*',
      'coverage/**/*',
      'dist/**/*',
      '**/*.d.ts',
      'test-output/**/*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.js'],
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      // Allow reasonable conditional logic in e2e tests for retry patterns
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-conditional-expect': 'off',
    },
  },
];
