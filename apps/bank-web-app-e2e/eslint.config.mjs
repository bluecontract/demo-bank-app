import baseConfig from '../../eslint.config.mjs';
import playwright from 'eslint-plugin-playwright';

export default [
  ...baseConfig,
  playwright.configs['flat/recommended'],
  {
    files: ['**/*.ts', '**/*.js'],
    ignores: ['out-tsc/**/*'],
    // Override or add rules here
    rules: {},
  },
];
