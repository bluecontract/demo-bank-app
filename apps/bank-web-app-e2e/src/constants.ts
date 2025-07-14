// Central constants for E2E tests
import { expect } from '@playwright/test';

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:4200';

// URL constants
export const URLS = {
  HOME: `${BASE_URL}/?e2e=true`,
  SIGNUP: `${BASE_URL}/signup?e2e=true`,
  DASHBOARD: `${BASE_URL}/dashboard`,
} as const;

// Test data constants
export const TEST_DATA = {
  VALIDATION: {
    MAX_NAME_LENGTH: 50,
  },
  TIMEOUTS: {
    NAVIGATION: 10000,
    MODAL_LOAD: 5000,
    API_RESPONSE: 8000,
    BALANCE_UPDATE: 5000,
  },
  AMOUNTS: {
    SMALL: '25.50',
    MEDIUM: '100.00',
    LARGE: '500.00',
  },
} as const;

// UI Text Constants (based on actual implementation)
export const UI_TEXT = {
  BALANCES: {
    ZERO: '$0', // formatCurrency(0) returns '$0', not '$0.00'
    FORMATTED: (amount: number) => {
      const isNegative = amount < 0;
      const absAmount = Math.abs(amount);
      const dollars = absAmount / 100;
      const hasCents = absAmount % 100 !== 0;
      const formattedAmount = hasCents
        ? dollars.toFixed(2)
        : dollars.toFixed(0);
      const parts = formattedAmount.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const finalAmount = parts.join('.');
      return isNegative ? `-$${finalAmount}` : `$${finalAmount}`;
    },
  },
  SUCCESS_MESSAGES: {
    TRANSFER_COMPLETED: 'Transfer completed!', // Legacy - text is split across elements
    TRANSFER_HEADER: 'Transfer', // First part of success message
    TRANSFER_COMPLETION: 'completed!', // Second part of success message
    FUND_COMPLETED: 'completed!', // Part of "Transfer completed!" message
  },
  BUTTONS: {
    HOME: 'Home', // From TransferConfirmation component
    BACK_TO_HOME: 'Back to Home', // Alternative text patterns
    FUND_ACCOUNT: 'Fund Account',
    NEW_TRANSFER: 'New transfer',
    DETAILS: 'Details',
    CREATE_ACCOUNT: 'Create Account',
    TRANSFER: 'Transfer',
    CANCEL: 'Cancel',
  },
  VALIDATION_ERRORS: {
    // Native HTML5 validation messages (shown by browser)
    PLEASE_FILL_OUT_FIELD: 'Please fill out this field.',
    // Custom JavaScript validation messages (shown after form submission)
    ACCOUNT_NAME_REQUIRED: 'Account name is required',
    ACCOUNT_NAME_TOO_LONG: 'Account name must be 100 characters or less',
    AMOUNT_REQUIRED: 'Amount is required',
    AMOUNT_POSITIVE: 'Amount must be positive',
    AMOUNT_VALID_NUMBER: 'Amount must be a valid number',
    AMOUNT_DECIMAL_PLACES:
      'Amount must be a valid number with up to 2 decimal places',
    DESTINATION_ACCOUNT_REQUIRED: 'Destination account number is required',
    DESTINATION_ACCOUNT_DIGITS: 'Account number must be exactly 10 digits',
    INSUFFICIENT_FUNDS: 'Insufficient funds',
    SAME_ACCOUNT: 'Cannot transfer to the same account',
  },
  MODAL_HEADERS: {
    CREATE_ACCOUNT: 'Create New Account',
    TRANSFER_MONEY: 'Transfer Money',
    FUND_ACCOUNT: 'Fund Account',
  },
} as const;

// Helper functions
export const createUniqueName = (prefix = 'testuser') => {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 5)}`;
};

export const createUniqueAccountName = (prefix = 'testaccount') => {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 5)}`;
};

export const createUniqueAmount = (baseAmount = 100) => {
  return (baseAmount + Math.floor(Math.random() * 50)).toFixed(2);
};

export const waitForModalToClose = async (
  page: import('@playwright/test').Page,
  modalTestId: string
) => {
  await expect(page.locator(`[data-testid="${modalTestId}"]`)).toBeHidden({
    timeout: TEST_DATA.TIMEOUTS.MODAL_LOAD,
  });
};

export const waitForModalToOpen = async (
  page: import('@playwright/test').Page,
  modalTestId: string
) => {
  await expect(page.locator(`[data-testid="${modalTestId}"]`)).toBeVisible({
    timeout: TEST_DATA.TIMEOUTS.MODAL_LOAD,
  });
};

export const DASHBOARD_HEADING_TEXT = 'Welcome back';

export const waitForTooltipToAppear = async (
  page: import('@playwright/test').Page,
  timeout = 2000
) => {
  await expect(page.locator('[role="tooltip"]')).toBeVisible({
    timeout,
  });
};

export const waitForTransferCompletion = async (
  page: import('@playwright/test').Page,
  timeout = 10000
) => {
  const container = page.locator('[data-testid="confirmation-container"]');
  await expect(container).toBeVisible({ timeout });

  // Verify both parts of the success message are present
  await expect(container.locator('h1')).toContainText('Transfer');
  await expect(container.locator('h2')).toContainText('completed!');

  // Verify the success illustration is present
  await expect(
    container.locator('[data-testid="success-illustration"]')
  ).toBeVisible();

  // Verify the home button is present
  await expect(container.locator('button')).toContainText('Home');
};

// Helper to check for form validation errors (either native HTML5 or custom JS)
export const expectFormValidationError = async (
  page: import('@playwright/test').Page,
  inputSelector: string,
  expectedErrorText?: string
) => {
  const input = page.locator(inputSelector);

  // Check if the input has validation constraint violation (HTML5 validation)
  const validationMessage = await input.evaluate(
    (el: any) => el.validationMessage
  );

  if (validationMessage) {
    // HTML5 validation is active
    expect(validationMessage).toBeTruthy();
    if (expectedErrorText) {
      expect(validationMessage).toContain(expectedErrorText);
    }
  } else if (expectedErrorText) {
    // Check for custom validation message in DOM
    await expect(page.getByText(expectedErrorText)).toBeVisible();
  }
};
