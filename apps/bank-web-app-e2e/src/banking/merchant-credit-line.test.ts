import { test, expect } from '@playwright/test';
import {
  URLS,
  TEST_DATA,
  createUniqueEmail,
  DASHBOARD_HEADING_TEXT,
  waitForModalToOpen,
  waitForModalToClose,
} from '../constants';

const createUniqueMerchantId = () =>
  `merchant-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

test.describe('Merchant Credit Line Flows', () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    const merchantEmail = createUniqueEmail('merchant-user');
    const merchantId = createUniqueMerchantId();

    await page.goto(URLS.SIGNUP);
    await page.fill('input[name="email"]', merchantEmail);
    await page.getByLabel('I am a merchant').check();
    await page.fill('input[name="merchantId"]', merchantId);
    await page.click('button[type="submit"]');

    await page.waitForURL(URLS.DASHBOARD, {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });
    await expect(page.getByText(DASHBOARD_HEADING_TEXT)).toBeVisible();
  });

  test('should create credit line account for merchant signup', async ({
    page,
  }) => {
    await expect(page.getByText('Credit Line', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Edit Credit Limit' })
    ).toBeVisible();
    await expect(page.getByText('Remaining Credit')).toBeVisible();
  });

  test('should update credit limit from the dashboard', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: 'Edit Credit Limit' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Edit Credit Limit' }).click();
    await waitForModalToOpen(page, 'credit-limit-modal-content');

    await page.fill('input#creditLimit', '6000');
    await page.click('button:has-text("Update limit")');

    await expect(page.getByText('Current limit: $6,000')).toBeVisible({
      timeout: TEST_DATA.TIMEOUTS.BALANCE_UPDATE,
    });
    await expect(page.getByText('Remaining credit: $6,000')).toBeVisible({
      timeout: TEST_DATA.TIMEOUTS.BALANCE_UPDATE,
    });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await waitForModalToClose(page, 'credit-limit-modal-content');

    await expect(page.getByText('Limit: $6,000')).toBeVisible({
      timeout: TEST_DATA.TIMEOUTS.BALANCE_UPDATE,
    });
    await expect(
      page.locator('.balance-display').getByText('$6,000', { exact: true })
    ).toBeVisible({
      timeout: TEST_DATA.TIMEOUTS.BALANCE_UPDATE,
    });
  });
});
