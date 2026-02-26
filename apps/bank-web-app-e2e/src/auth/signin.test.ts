import { test, expect, type Page } from '@playwright/test';
import {
  BASE_URL,
  DASHBOARD_HEADING_TEXT,
  TEST_DATA,
  createUniqueEmail,
} from '../constants';

const waitForDashboard = async (page: Page, userEmail?: string) => {
  await expect(page).toHaveURL(/\/dashboard(?:\/|$|\?)/, {
    timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
  });

  await page.waitForLoadState('domcontentloaded', {
    timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
  });

  const dashboardContainer = page.locator(
    '[data-testid="dashboard-main-container"]'
  );

  await dashboardContainer.waitFor({
    state: 'attached',
    timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
  });
  await dashboardContainer.waitFor({
    state: 'visible',
    timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
  });

  const loadingSpinner = page.locator(
    '[data-testid="accounts-loading-spinner"]'
  );
  await loadingSpinner
    .waitFor({ state: 'detached', timeout: TEST_DATA.TIMEOUTS.BALANCE_UPDATE })
    .catch(() => {
      /* spinner may not appear if data loads instantly */
    });
  await expect(
    dashboardContainer.getByText(DASHBOARD_HEADING_TEXT, { exact: true })
  ).toBeVisible();

  if (userEmail) {
    await expect(
      dashboardContainer.getByText(userEmail, { exact: true })
    ).toBeVisible();
  }
};

const waitForSignedOut = async (page: Page) => {
  await page.waitForURL(
    url => url.pathname === '/' || url.pathname === '/signin',
    { timeout: TEST_DATA.TIMEOUTS.NAVIGATION }
  );
};

test.describe('Sign In Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/signin`);
  });

  test('should allow user to sign in with valid email', async ({ page }) => {
    const testUserEmail = createUniqueEmail('test-signin');

    // First, create a user by signing up
    await page.goto(`${BASE_URL}/signup`);
    await page.fill('input[name="email"]', testUserEmail);
    await page.click('button[type="submit"]');

    await waitForDashboard(page, testUserEmail);

    // Sign out
    // First click on the avatar to open the dropdown
    await page.click('button[aria-haspopup="true"]');
    // Then click on the Sign Out button
    await page.click('button:has-text("Sign Out")');

    // Should be redirected to home or sign-in page
    await waitForSignedOut(page);

    // Now sign in with the same credentials
    await page.goto(`${BASE_URL}/signin`);
    await page.fill('input[name="email"]', testUserEmail);
    await page.click('button[type="submit"]');

    await waitForDashboard(page, testUserEmail);
    await expect(page).toHaveURL(/\/dashboard(?:\/|$|\?)/);
  });

  test('should show error for non-existent user', async ({ page }) => {
    const nonExistentUser = createUniqueEmail('nonexistent');

    await page.fill('input[name="email"]', nonExistentUser);
    await page.click('button[type="submit"]');

    // Should show error message
    await expect(
      page.getByText('Sign in failed. Please try again.')
    ).toBeVisible();

    // Should stay on sign-in page
    expect(page.url()).toContain('/signin');
  });

  test('should validate required fields', async ({ page }) => {
    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should show validation error
    await expect(page.getByText('Email is required')).toBeVisible();

    // Should stay on sign-in page
    expect(page.url()).toContain('/signin');
  });

  test('should redirect to dashboard when accessing protected route while authenticated', async ({
    page,
  }) => {
    const testUserEmail = createUniqueEmail('test-protected');

    // Sign up first
    await page.goto(`${BASE_URL}/signup`);
    await page.fill('input[name="email"]', testUserEmail);
    await page.click('button[type="submit"]');

    await waitForDashboard(page, testUserEmail);

    // Try to access dashboard directly - should stay on dashboard
    await page.goto(`${BASE_URL}/dashboard`);
    await waitForDashboard(page, testUserEmail);
    await expect(page).toHaveURL(/\/dashboard(?:\/|$|\?)/);
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
    const testUserEmail = createUniqueEmail('test-signout');

    // Sign up first
    await page.goto(`${BASE_URL}/signup`);
    await page.fill('input[name="email"]', testUserEmail);
    await page.click('button[type="submit"]');

    await waitForDashboard(page, testUserEmail);

    // Sign out
    // First click on the avatar to open the dropdown
    await page.click('button[aria-haspopup="true"]');
    // Then click on the Sign Out button
    await page.click('button:has-text("Sign Out")');

    // Should be redirected to home or sign-in page
    await waitForSignedOut(page);

    // Try to access dashboard after sign out - should be redirected to signin
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForURL(`${BASE_URL}/signin`);
    await expect(
      page.getByRole('heading', { name: 'Welcome Back' })
    ).toBeVisible();
  });

  test('should persist session across page reloads', async ({ page }) => {
    const testUserEmail = createUniqueEmail('test-session');

    // Sign up first
    await page.goto(`${BASE_URL}/signup`);
    await page.fill('input[name="email"]', testUserEmail);
    await page.click('button[type="submit"]');

    await waitForDashboard(page, testUserEmail);

    // Reload the page
    await page.reload();

    // Should still be authenticated and on dashboard
    await waitForDashboard(page, testUserEmail);
    await expect(page.getByText(testUserEmail, { exact: true })).toBeVisible();
  });
});
