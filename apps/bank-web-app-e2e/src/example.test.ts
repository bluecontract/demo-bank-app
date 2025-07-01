import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.BANK_API_URL || 'http://localhost:3000';

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

  test('backend API is healthy', async ({ request }) => {
    // Add retry logic for flaky backend connections
    let lastError = '';
    let response;
    let success = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await request.get(`${API_BASE_URL}/health`);

        if (response.ok()) {
          // Success, break out of retry loop
          success = true;
          break;
        } else {
          lastError = `HTTP ${response.status()}: ${response.statusText()}`;
          if (attempt < 3) {
            console.log(
              `API health check attempt ${attempt} failed: ${lastError}, retrying...`
            );
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < 3) {
          console.log(
            `API health check attempt ${attempt} failed: ${lastError}, retrying...`
          );
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
        }
      }
    }

    // Assert the final response
    expect(
      success,
      `API health check failed after 3 attempts. Last error: ${lastError}`
    ).toBeTruthy();

    if (response) {
      const responseBody = await response.json();
      expect(responseBody).toHaveProperty('status', 'healthy');
    }
  });
});
