import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect h1 to contain a substring.
  expect(await page.locator('h1').innerText()).toContain('Welcome');
});

test('displays health status', async ({ page }) => {
  await page.goto('/');

  // Wait for the health status component to appear
  await page.waitForSelector('text=System Health', { timeout: 15000 });

  // Health status component should always be visible
  await expect(page.locator('text=System Health')).toBeVisible();

  // Backend health is verified by the health check script before tests run
  // But the frontend still needs time to fetch and render the health data
  // Wait for health status data to load (up to 15 seconds)
  await expect(page.locator('text=Status:')).toBeVisible({ timeout: 15000 });

  // Once we see the Status field, wait a bit more for all health data to populate
  await expect(
    page.locator('text=Backend service is not available')
  ).not.toBeVisible({ timeout: 15000 });

  // Expect all healthy status elements to be visible
  await expect(page.locator('text=Status:')).toBeVisible();
  await expect(page.locator('text=Version:')).toBeVisible();
  await expect(page.locator('text=Environment:')).toBeVisible();
  await expect(page.locator('text=Last checked:')).toBeVisible();
});
