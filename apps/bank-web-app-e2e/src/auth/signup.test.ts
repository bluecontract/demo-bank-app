import { test, expect } from '@playwright/test';
import {
  URLS,
  TEST_DATA,
  createUniqueName,
  DASHBOARD_HEADING_TEXT,
} from '../constants';

test.describe('Sign Up Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Start from the home page with E2E test mode enabled
    await page.goto(URLS.HOME);
  });

  test('should navigate to signup page from home', async ({ page }) => {
    // Click on Sign Up button
    await page.click('text=Sign Up');

    // Should be on signup page
    await expect(page).toHaveURL(URLS.SIGNUP);
    await expect(
      page.getByRole('heading', { name: 'Join Blue Bank' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Create Account' })
    ).toBeVisible();
  });

  test('should successfully sign up with valid name', async ({ page }) => {
    // Navigate to signup page with E2E mode
    await page.goto(URLS.SIGNUP);

    // Fill in the form with unique test name
    const uniqueName = createUniqueName();
    await page.fill('input[name="name"]', uniqueName);

    // Submit the form
    await page.click('button[type="submit"]');

    // Should show loading state briefly
    await expect(page.getByText('Creating Account...')).toBeVisible();

    // Button should be disabled during loading
    await expect(page.locator('button[type="submit"]')).toBeDisabled();

    // Should navigate to dashboard after successful signup
    await expect(page).toHaveURL(URLS.DASHBOARD, {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });

    // Should see dashboard content
    await expect(page.getByText(DASHBOARD_HEADING_TEXT)).toBeVisible();
  });

  test('should show validation errors for empty name and clear them when typing', async ({
    page,
  }) => {
    // Navigate to signup page with E2E mode
    await page.goto(URLS.SIGNUP);

    // Try to submit without entering name
    await page.click('button[type="submit"]');

    // Should show validation error
    await expect(page.getByText('Name is required')).toBeVisible();

    // Should not navigate away
    await expect(page).toHaveURL(URLS.SIGNUP);

    // Start typing in the name field
    await page.fill('input[name="name"]', 'a');

    // Error should disappear
    await expect(page.getByText('Name is required')).toBeHidden();
  });

  test('should show validation errors for name too long', async ({ page }) => {
    // Navigate to signup page with E2E mode
    await page.goto(URLS.SIGNUP);

    // Enter a name that's too long (over 50 characters)
    const longName = 'a'.repeat(TEST_DATA.VALIDATION.MAX_NAME_LENGTH + 1);
    await page.fill('input[name="name"]', longName);

    // Submit the form
    await page.click('button[type="submit"]');

    // Should show validation error
    await expect(
      page.getByText('Name must be 50 characters or less')
    ).toBeVisible();

    // Should not navigate away
    await expect(page).toHaveURL(URLS.SIGNUP);
  });

  test('should handle duplicate name error by signing up twice', async ({
    page,
  }) => {
    // Navigate to signup page with E2E mode
    await page.goto(URLS.SIGNUP);

    // Create a unique test name for this test
    const testName = createUniqueName('duplicate-test');

    // First signup - should succeed
    await page.fill('input[name="name"]', testName);
    await page.click('button[type="submit"]');

    // Should navigate to dashboard
    await expect(page).toHaveURL(URLS.DASHBOARD, {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });

    // Go back to signup page
    await page.goto(URLS.SIGNUP);

    // Try to signup again with the same name
    await page.fill('input[name="name"]', testName);
    await page.click('button[type="submit"]');

    // Should show error message for duplicate name
    await expect(
      page.getByText(
        'A user with this name already exists. Please choose a different name.'
      )
    ).toBeVisible();

    // Should not navigate away
    await expect(page).toHaveURL(URLS.SIGNUP);
  });
});
