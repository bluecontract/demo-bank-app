import { test, expect } from '@playwright/test';
import {
  TEST_DATA,
  waitForModalToOpen,
  waitForModalToClose,
  signUpMerchantAndReachDashboard,
} from '../constants';

test.describe('Merchant Credit Line Flows', () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await signUpMerchantAndReachDashboard(page);
  });

  test('should create credit line account for merchant signup', async ({
    page,
  }) => {
    await expect(page.getByText('Merchant Credit Line')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByText('Limit: $5,000')).toBeVisible();
  });

  test('should update credit limit from the dashboard', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
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
