import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  outputDir: './test-output/artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 4 : undefined,
  timeout: 10000,
  expect: {
    timeout: 5000,
  },
  reporter: process.env.CI
    ? [
        ['json', { outputFile: 'test-output/results.json' }],
        ['junit', { outputFile: 'test-output/junit.xml' }],
        ['github'],
      ]
    : [
        ['list'],
        ['html', { outputFolder: 'test-output/html-report' }],
        ['json', { outputFile: 'test-output/results.json' }],
      ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 10000,
    actionTimeout: 5000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
