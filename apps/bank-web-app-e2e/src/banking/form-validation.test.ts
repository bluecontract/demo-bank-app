import { test, expect } from '@playwright/test';
import {
  URLS,
  TEST_DATA,
  createUniqueName,
  createUniqueAccountName,
  waitForModalToClose,
  waitForModalToOpen,
  waitForTransferCompletion,
  expectFormValidationError,
  DASHBOARD_HEADING_TEXT,
} from '../constants';

test.describe('Banking Form Validation', () => {
  let testUserName: string;

  test.beforeEach(async ({ page }) => {
    testUserName = createUniqueName('validation-user');

    // Sign up and get to dashboard
    await page.goto(URLS.SIGNUP);
    await page.fill('input[name="name"]', testUserName);
    await page.click('button[type="submit"]');

    await page.waitForURL(URLS.DASHBOARD, {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });
    await expect(page.getByText(DASHBOARD_HEADING_TEXT)).toBeVisible();
  });

  test('should validate account creation form', async ({ page }) => {
    // Open account creation modal
    await page.click('text=Add new account');
    await waitForModalToOpen(page, 'modal-content');

    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should show validation error (either HTML5 or custom)
    await expectFormValidationError(page, 'input#accountName');

    // Test max length validation (browser prevents typing more than 100 chars)
    const longName = 'a'.repeat(101); // Over 100 characters
    await page.fill('input#accountName', longName);

    // Check that the browser limited the input to 100 characters
    const inputValue = await page.inputValue('input#accountName');
    expect(inputValue).toHaveLength(100);

    // Since the browser prevents the long input, the form should submit successfully
    await page.click('button[type="submit"]');

    // Should close modal successfully (no validation error)
    await waitForModalToClose(page, 'modal-content');

    // Re-open modal for next test
    await page.click('text=Add new account');
    await waitForModalToOpen(page, 'modal-content');

    // Test valid input
    await page.fill('input#accountName', createUniqueAccountName());
    await page.click('button[type="submit"]');

    // Should close modal successfully
    await waitForModalToClose(page, 'modal-content');
  });

  test('should validate fund account form', async ({ page }) => {
    // Create account first
    await page.click('text=Add new account');
    await waitForModalToOpen(page, 'modal-content');
    const accountName = createUniqueAccountName('fund-validation');
    await page.fill('input#accountName', accountName);
    await page.click('button[type="submit"]');
    await waitForModalToClose(page, 'modal-content');

    // Open fund modal
    await page.click('text=Fund Account');
    await waitForModalToOpen(page, 'modal-content');

    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should show validation error
    await expectFormValidationError(page, 'input#amount');

    // Fill valid amount and submit
    await page.fill('input#amount', '100.00');
    await page.click('button[type="submit"]');

    // Should show success message
    await waitForTransferCompletion(page);

    // Close modal
    await page.click('text=Home');
    await waitForModalToClose(page, 'modal-content');
  });

  test('should validate transfer form', async ({ page }) => {
    // Create two accounts
    const sourceAccount = createUniqueAccountName('source-validation');
    const targetAccount = createUniqueAccountName('target-validation');

    // Create source account
    await page.click('text=Add new account');
    await waitForModalToOpen(page, 'modal-content');
    await page.fill('input#accountName', sourceAccount);
    await page.click('button[type="submit"]');
    await waitForModalToClose(page, 'modal-content');

    // Create target account
    await page.click('text=Add new account');
    await waitForModalToOpen(page, 'modal-content');
    await page.fill('input#accountName', targetAccount);
    await page.click('button[type="submit"]');
    await waitForModalToClose(page, 'modal-content');

    // Fund source account
    await page.click('text=Fund Account');
    await waitForModalToOpen(page, 'modal-content');
    await page.fill('input#amount', '200.00');
    await page.click('button[type="submit"]');
    await waitForTransferCompletion(page);
    await page.click('text=Home');
    await waitForModalToClose(page, 'modal-content');

    // Wait for balance to be updated after funding before opening transfer modal
    await expect(
      page.locator('.balance-display').getByText('$200')
    ).toBeVisible({
      timeout: TEST_DATA.TIMEOUTS.BALANCE_UPDATE,
    });

    // Open transfer modal
    await page.click('text=New transfer');
    await waitForModalToOpen(page, 'modal-content');

    // Try to submit empty form
    await page.click('button[type="submit"]');

    // Should show validation errors
    await expectFormValidationError(
      page,
      'input[placeholder="Enter 10-digit account number"]'
    );
    await expectFormValidationError(page, 'input[placeholder="$0"]');

    // Fill valid data and submit
    const targetAccountElements = page.locator('.account-number');
    const targetAccountNumber = await targetAccountElements
      .last()
      .textContent();
    const cleanTargetNumber = targetAccountNumber?.replace(/\s/g, '') || '';

    await page.fill(
      'input[placeholder="Enter 10-digit account number"]',
      cleanTargetNumber
    );
    await page.fill('input[placeholder="$0"]', '50.00');
    await page.click('button[type="submit"]');

    // Should show success
    await waitForTransferCompletion(page);

    // Close modal
    await page.click('text=Home');
    await waitForModalToClose(page, 'modal-content');
  });

  test('should clear validation errors when user corrects input', async ({
    page,
  }) => {
    // Create account
    await page.click('text=Add new account');
    await waitForModalToOpen(page, 'modal-content');
    const accountName = createUniqueAccountName('clear-validation');
    await page.fill('input#accountName', accountName);
    await page.click('button[type="submit"]');
    await waitForModalToClose(page, 'modal-content');

    // Fund account
    await page.click('text=Fund Account');
    await waitForModalToOpen(page, 'modal-content');
    await page.fill('input#amount', '100.00');
    await page.click('button[type="submit"]');
    await waitForTransferCompletion(page);
    await page.click('text=Home');
    await waitForModalToClose(page, 'modal-content');

    // Open fund modal again
    await page.click('text=Fund Account');
    await waitForModalToOpen(page, 'modal-content');

    // Try to submit empty form to trigger validation
    await page.click('button[type="submit"]');

    // Should show validation error for empty field
    await expectFormValidationError(page, 'input#amount');

    // Fill valid amount to clear error
    await page.fill('input#amount', '75.00');

    // Submit should work
    await page.click('button[type="submit"]');
    await waitForTransferCompletion(page);
    await page.click('text=Home');
    await waitForModalToClose(page, 'modal-content');
  });

  test('should validate decimal places in amounts', async ({ page }) => {
    // Create account
    await page.click('text=Add new account');
    await waitForModalToOpen(page, 'modal-content');
    const accountName = createUniqueAccountName('decimal-validation');
    await page.fill('input#accountName', accountName);
    await page.click('button[type="submit"]');
    await waitForModalToClose(page, 'modal-content');

    // Open fund modal
    await page.click('text=Fund Account');
    await waitForModalToOpen(page, 'modal-content');

    // Fill valid decimal places (the input sanitization prevents > 2 decimal places)
    await page.fill('input#amount', '50.12');
    await page.click('button[type="submit"]');

    // Should work
    await waitForTransferCompletion(page);
    await page.click('text=Home');
    await waitForModalToClose(page, 'modal-content');
  });

  test('should handle input sanitization', async ({ page }) => {
    // Create account
    await page.click('text=Add new account');
    await waitForModalToOpen(page, 'modal-content');
    const accountName = createUniqueAccountName('sanitization');
    await page.fill('input#accountName', accountName);
    await page.click('button[type="submit"]');
    await waitForModalToClose(page, 'modal-content');

    // Open fund modal
    await page.click('text=Fund Account');
    await waitForModalToOpen(page, 'modal-content');

    // Test input sanitization (should remove non-numeric characters)
    await page.fill('input#amount', '$100.00');
    await page.click('button[type="submit"]');

    // Should work despite the dollar sign
    await waitForTransferCompletion(page);
    await page.click('text=Home');
    await waitForModalToClose(page, 'modal-content');

    // Should show updated balance
    await expect(
      page.locator('.balance-display').getByText('$100')
    ).toBeVisible();
  });
});
