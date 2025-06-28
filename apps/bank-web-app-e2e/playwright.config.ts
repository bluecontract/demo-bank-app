import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';
import { fileURLToPath } from 'url';

// For CI, E2E_BASE_URL is set to the deployed application URL
// For local development, defaults to localhost
const baseURL =
  process.env['E2E_BASE_URL'] ||
  process.env['BASE_URL'] ||
  'http://localhost:4300';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  ...nxE2EPreset(fileURLToPath(import.meta.url), { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  /* Run your local dev server before starting the tests */
  /*
   * For local development, Nx dependency management auto-starts backend via dependsOn.
   * Only auto-start frontend for local testing, disable for CI or remote environments.
   *
   * Scenarios:
   * - Local development: webServer starts frontend, Nx starts backend automatically
   * - CI environments: webServer disabled (manual server startup in CI workflows)
   * - Remote environments: webServer disabled (tests against live env)
   */
  webServer:
    process.env['CI'] ||
    (process.env['E2E_BASE_URL'] &&
      !process.env['E2E_BASE_URL'].includes('localhost'))
      ? undefined
      : {
          command: 'npx nx run @demo-blue/bank-web-app:preview',
          url: 'http://localhost:4300',
          reuseExistingServer: true,
          cwd: workspaceRoot,
        },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Uncomment for mobile browsers support
    /* {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    }, */

    // Uncomment for branded browsers
    /* {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    } */
  ],
});
