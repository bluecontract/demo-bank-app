import { test, expect } from '@playwright/test';
import {
  URLS,
  TEST_DATA,
  createUniqueEmail,
  createUniqueAccountName,
  waitForModalToClose,
  waitForModalToOpen,
  waitForTransferCompletion,
  expectFormValidationError,
  DASHBOARD_HEADING_TEXT,
} from '../constants';

test.describe('Banking Form Validation', () => {
  test.describe.configure({ timeout: 60000 });
  test.beforeEach(async ({ page }) => {
    const testUserEmail = createUniqueEmail('validation-user');

    // Sign up and get to dashboard
    await page.goto(URLS.SIGNUP);
    await page.fill('input[name="email"]', testUserEmail);
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

    const accountNumberElements = page.locator('.account-number');
    await expect(accountNumberElements).toHaveCount(2, {
      timeout: TEST_DATA.TIMEOUTS.API_RESPONSE,
    });
    const sanitizedAccountNumbers = await accountNumberElements
      .allTextContents()
      .then(contents => contents.map(content => content.replace(/\s/g, '')));
    const [, targetAccountNumberRaw] = sanitizedAccountNumbers;
    expect(targetAccountNumberRaw).toBeDefined();
    const cleanTargetNumber = targetAccountNumberRaw!;

    await Promise.all([
      page.waitForURL('**/transfer/new**', {
        timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
      }),
      page.click('text=New transfer'),
    ]);

    await expect(page.getByText('Initiate New Transfer')).toBeVisible();

    const nextButton = page.getByRole('button', { name: 'Next' });
    await expect(nextButton).toBeEnabled();

    const amountModal = page.locator('[data-testid="amount-required-modal"]');
    await nextButton.click();
    await expect(amountModal).toBeVisible();
    await amountModal.getByRole('button', { name: 'Close' }).click();
    await expect(amountModal).toHaveCount(0);

    const amountInput = page.locator('#totalAmount');
    await amountInput.fill('0');
    await expect(nextButton).toBeDisabled();

    await amountInput.fill('150.129');
    await expect(amountInput).toHaveValue('150.12');
    await expect(nextButton).toBeEnabled();

    const fromAccountSelect = page.locator('#fromAccount');
    const sourceOptionValue = await fromAccountSelect
      .locator('option')
      .evaluateAll<string | null, string>((options, accountName) => {
        const optionElements = options as Array<{
          textContent?: string | null;
          value?: string | null;
        }>;
        const matching = optionElements.find(option =>
          option.textContent?.includes(accountName)
        );
        return matching?.value ?? null;
      }, sourceAccount);
    expect(sourceOptionValue).toBeTruthy();
    if (!sourceOptionValue) {
      throw new Error('Source account option not found');
    }
    await fromAccountSelect.selectOption(sourceOptionValue);

    const accountNumberInput = page.locator('#toAccount');
    const destinationModal = page.locator(
      '[data-testid="to-account-required-modal"]'
    );

    await nextButton.click();
    await expect(destinationModal).toBeVisible();
    await expect(
      destinationModal.getByText(
        'To account needs to be set before continuing.'
      )
    ).toBeVisible();
    await destinationModal.getByRole('button', { name: 'Close' }).click();
    await expect(destinationModal).toHaveCount(0);

    await accountNumberInput.fill('abc123');
    await expect(accountNumberInput).toHaveValue('123');

    await nextButton.click();
    await expect(destinationModal).toBeVisible();
    await expect(
      destinationModal.getByText('Recipient account must be exactly 10 digits.')
    ).toBeVisible();
    await destinationModal.getByRole('button', { name: 'Close' }).click();
    await expect(destinationModal).toHaveCount(0);

    // Fill valid data
    await accountNumberInput.fill(cleanTargetNumber);
    await expect(accountNumberInput).toHaveValue(cleanTargetNumber);

    await page.fill('#recipientName', 'Validation Recipient');
    await page.fill('#title', 'Validation Transfer');

    await expect(nextButton).toBeEnabled();
    await nextButton.click();

    await expect(page.getByText('Review Transfer Details')).toBeVisible();
    const reviewNextButton = page.getByRole('button', { name: 'Next' });
    await expect(reviewNextButton).toBeEnabled();
    await reviewNextButton.click();

    await expect(page.getByText('Authorize Transfer')).toBeVisible();
    const authorizeButton = page.getByRole('button', { name: 'Authorize' });
    await expect(authorizeButton).toBeEnabled();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.waitForURL(URLS.DASHBOARD, {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });
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
