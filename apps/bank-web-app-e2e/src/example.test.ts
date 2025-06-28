import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect h1 to contain a substring.
  expect(await page.locator('h1').innerText()).toContain('Welcome');
});

test('displays health status', async ({ page }) => {
  await page.goto('/');

  // Wait for the health status to appear
  await page.waitForSelector('text=System Health', { timeout: 10000 });

  // Check that health status elements are present
  await expect(page.locator('text=System Health')).toBeVisible();
  await expect(page.locator('text=Status:')).toBeVisible();
  await expect(page.locator('text=Version:')).toBeVisible();
  await expect(page.locator('text=Environment:')).toBeVisible();
  await expect(page.locator('text=Last checked:')).toBeVisible();
});
