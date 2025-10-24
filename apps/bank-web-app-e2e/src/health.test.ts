import { test, expect } from '@playwright/test';

test.describe('Health Check', () => {
  test('displays health status', async ({ page }) => {
    // Go to the app
    await page.goto('/');

    // Verify the page title
    await expect(page).toHaveTitle(/DemoBlue/);

    // Wait for the compact status control
    const statusButton = page.getByRole('button', {
      name: /System status: healthy/i,
    });
    await expect(statusButton).toBeVisible({ timeout: 15000 });

    // Hover to reveal the detailed tooltip and verify its contents
    await statusButton.hover();
    const tooltip = page.locator(
      '[role="tooltip"], div:has(h3:has-text("System Health"))'
    );

    await expect(
      tooltip.getByRole('heading', { name: 'System Health' })
    ).toBeVisible({ timeout: 10000 });

    await expect(tooltip.locator('text=Status: healthy')).toBeVisible();
    await expect(tooltip.locator('text=Version:')).toBeVisible();
    await expect(tooltip.locator('text=Environment:')).toBeVisible();
    await expect(tooltip.locator('text=Last checked:')).toBeVisible();
  });
});
