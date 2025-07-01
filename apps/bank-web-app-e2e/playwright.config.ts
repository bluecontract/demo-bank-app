import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  outputDir: './test-output',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 3 : 1,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  reporter: [
    ['html', { outputFolder: 'test-output/html-report' }],
    ['json', { outputFile: 'test-output/results.json' }],
    ['junit', { outputFile: 'test-output/junit.xml' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 30000,
    actionTimeout: 15000,
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
  ],
  webServer:
    process.env.CI ||
    process.env.E2E_BASE_URL?.includes('cloudfront') ||
    process.env.E2E_BASE_URL?.includes('https://')
      ? undefined
      : {
          command: 'npm run serve:stack',
          url: 'http://localhost:4200',
          reuseExistingServer: true,
          timeout: 180 * 1000,
        },
});
