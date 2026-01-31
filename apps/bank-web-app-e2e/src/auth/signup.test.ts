import { test, expect } from '@playwright/test';
import {
  URLS,
  TEST_DATA,
  createUniqueEmail,
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
      page.getByRole('heading', { name: 'Join Demo Bank' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Create Account' })
    ).toBeVisible();
    await expect(
      page.getByText(
        'I agree to the collection of my email address by Blue Language Labs Inc. and its use for future marketing communications.'
      )
    ).toBeVisible();
  });

  test('should successfully sign up with valid email', async ({ page }) => {
    // Navigate to signup page with E2E mode
    await page.goto(URLS.SIGNUP);

    // Fill in the form with unique test email
    const uniqueEmail = createUniqueEmail();
    await page.fill('input[name="email"]', uniqueEmail);

    // Marketing consent checked by default
    const marketingCheckbox = page.getByLabel(
      'I agree to the collection of my email address by Blue Language Labs Inc. and its use for future marketing communications.'
    );
    await expect(marketingCheckbox).toBeChecked();

    // Submit the form
    await page.click('button[type="submit"]');

    const loadingState = page.getByText('Creating Account...');
    const submitButton = page.locator('button[type="submit"]');
    const sawLoading = await loadingState
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);

    if (sawLoading) {
      const submitExists = (await submitButton.count()) > 0;
      if (submitExists) {
        await expect(submitButton).toBeDisabled();
      }
    }

    // Should navigate to dashboard after successful signup
    await expect(page).toHaveURL(URLS.DASHBOARD, {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });

    // Should see dashboard content
    await expect(page.getByText(DASHBOARD_HEADING_TEXT)).toBeVisible();
  });

  test('should show validation errors for empty email and clear them when typing', async ({
    page,
  }) => {
    // Navigate to signup page with E2E mode
    await page.goto(URLS.SIGNUP);

    // Try to submit without entering email
    await page.click('button[type="submit"]');

    // Should show validation error
    await expect(page.getByText('Email is required')).toBeVisible();

    // Should not navigate away
    await expect(page).toHaveURL(URLS.SIGNUP);

    // Start typing in the email field
    await page.fill('input[name="email"]', 'a');

    // Error should disappear
    await expect(page.getByText('Email is required')).toBeHidden();
  });

  test('should show validation errors for email too long', async ({ page }) => {
    // Navigate to signup page with E2E mode
    await page.goto(URLS.SIGNUP);

    // Enter an email that's too long (over 254 characters)
    const localPartLength =
      TEST_DATA.VALIDATION.MAX_EMAIL_LENGTH - '@example.com'.length + 1;
    const longEmail = `${'a'.repeat(localPartLength)}@example.com`;
    await page.fill('input[name="email"]', longEmail);

    // Submit the form
    await page.click('button[type="submit"]');

    // Should show validation error
    await expect(
      page.getByText('Email must be 254 characters or less')
    ).toBeVisible();

    // Should not navigate away
    await expect(page).toHaveURL(URLS.SIGNUP);
  });

  test('should handle duplicate email error by signing up twice', async ({
    page,
  }) => {
    // Navigate to signup page with E2E mode
    await page.goto(URLS.SIGNUP);

    // Create a unique test email for this test
    const testEmail = createUniqueEmail('duplicate-test');

    // First signup - should succeed
    await page.fill('input[name="email"]', testEmail);
    await page.click('button[type="submit"]');

    // Should navigate to dashboard
    await expect(page).toHaveURL(URLS.DASHBOARD, {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });

    // Go back to signup page
    await page.goto(URLS.SIGNUP);

    // Try to signup again with the same name
    await page.fill('input[name="email"]', testEmail);
    await page.click('button[type="submit"]');

    // Should show error message for duplicate email
    await expect(
      page.getByText(
        'A user with this email already exists. Please use a different email.'
      )
    ).toBeVisible();

    // Should not navigate away
    await expect(page).toHaveURL(URLS.SIGNUP);
  });
});
