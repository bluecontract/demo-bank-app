import { test, expect } from '@playwright/test';
import { BASE_URL, DASHBOARD_HEADING_TEXT } from '../constants';

test.describe('Sign In Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/signin`);
  });

  test('should allow user to sign in with valid name', async ({ page }) => {
    const testUserName = `test-signin-${Date.now()}`;

    // First, create a user by signing up
    await page.goto(`${BASE_URL}/signup`);
    await page.fill('input[name="name"]', testUserName);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // Verify we're on the dashboard
    await expect(page.getByText(DASHBOARD_HEADING_TEXT)).toBeVisible();
    await expect(page.getByText(testUserName)).toBeVisible();

    // Sign out
    // First click on the avatar to open the dropdown
    await page.click('button[aria-haspopup="true"]');
    // Then click on the Sign Out button
    await page.click('button:has-text("Sign Out")');

    // Should be redirected to home page
    await page.waitForURL(`${BASE_URL}/`);

    // Now sign in with the same credentials
    await page.goto(`${BASE_URL}/signin`);
    await page.fill('input[name="name"]', testUserName);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // Verify we're on the dashboard again
    await expect(page.getByText(DASHBOARD_HEADING_TEXT)).toBeVisible();
    await expect(page.getByText(testUserName)).toBeVisible();
  });

  test('should show error for non-existent user', async ({ page }) => {
    const nonExistentUser = `nonexistent-${Date.now()}`;

    await page.fill('input[name="name"]', nonExistentUser);
    await page.click('button[type="submit"]');

    // Should show error message
    await expect(
      page.getByText('User not found. Please check the name and try again.')
    ).toBeVisible();

    // Should stay on sign-in page
    expect(page.url()).toContain('/signin');
  });

  test('should validate required fields', async ({ page }) => {
    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should show validation error
    await expect(page.getByText('Name is required')).toBeVisible();

    // Should stay on sign-in page
    expect(page.url()).toContain('/signin');
  });

  test('should redirect to dashboard when accessing protected route while authenticated', async ({
    page,
  }) => {
    const testUserName = `test-protected-${Date.now()}`;

    // Sign up first
    await page.goto(`${BASE_URL}/signup`);
    await page.fill('input[name="name"]', testUserName);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // Try to access dashboard directly - should stay on dashboard
    await page.goto(`${BASE_URL}/dashboard`);
    await expect(page.getByText(DASHBOARD_HEADING_TEXT)).toBeVisible();
    await expect(page.getByText(testUserName)).toBeVisible();
  });

  test('should redirect to signin when accessing protected route while unauthenticated', async ({
    page,
  }) => {
    // Try to access dashboard without authentication
    await page.goto(`${BASE_URL}/dashboard`);

    // Should be redirected to signin page
    await page.waitForURL(`${BASE_URL}/signin`);
    await expect(
      page.getByRole('heading', { name: 'Welcome Back' })
    ).toBeVisible();
  });

  test('should handle sign out properly', async ({ page }) => {
    const testUserName = `test-signout-${Date.now()}`;

    // Sign up first
    await page.goto(`${BASE_URL}/signup`);
    await page.fill('input[name="name"]', testUserName);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // Sign out
    // First click on the avatar to open the dropdown
    await page.click('button[aria-haspopup="true"]');
    // Then click on the Sign Out button
    await page.click('button:has-text("Sign Out")');

    // Should be redirected to home page
    await page.waitForURL(`${BASE_URL}/`);

    // Try to access dashboard after sign out - should be redirected to signin
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForURL(`${BASE_URL}/signin`);
    await expect(
      page.getByRole('heading', { name: 'Welcome Back' })
    ).toBeVisible();
  });

  test('should persist session across page reloads', async ({ page }) => {
    const testUserName = `test-session-${Date.now()}`;

    // Sign up first
    await page.goto(`${BASE_URL}/signup`);
    await page.fill('input[name="name"]', testUserName);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(`${BASE_URL}/dashboard`);

    // Reload the page
    await page.reload();

    // Should still be authenticated and on dashboard
    await expect(page.getByText(DASHBOARD_HEADING_TEXT)).toBeVisible();
    await expect(page.getByText(testUserName)).toBeVisible();
  });
});
