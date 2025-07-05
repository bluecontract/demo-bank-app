import { test, expect } from '@playwright/test';

test.describe('Health Check', () => {
  test('displays health status', async ({ page }) => {
    // Go to the app
    await page.goto('/');

    // Verify the page title
    await expect(page).toHaveTitle(/DemoBlue/);

    // Check for the System Health heading
    await expect(page.locator('h3:has-text("System Health")')).toBeVisible();

    // Wait for health status to load and verify it shows healthy status
    await expect(page.locator('text=✅ Status: healthy')).toBeVisible({
      timeout: 20000,
    });

    // Verify other health information is present
    await expect(page.locator('text=Version:')).toBeVisible();
    await expect(page.locator('text=Environment:')).toBeVisible();
    await expect(page.locator('text=Last checked:')).toBeVisible();
  });

  test('has title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/DemoBlue/);
  });
});
