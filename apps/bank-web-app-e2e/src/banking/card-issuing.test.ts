import { test, expect } from '@playwright/test';
import {
  URLS,
  TEST_DATA,
  createUniqueEmail,
  createUniqueAccountName,
  waitForModalToOpen,
  waitForModalToClose,
  waitForTransferCompletion,
  DEFAULT_TEST_ORIGIN,
} from '../constants';

const BANK_API_URL = process.env.BANK_API_URL || 'http://localhost:3000';
const PROCESSOR_TOKEN =
  process.env.CARD_PROCESSOR_TOKEN || 'demo-bank-processor-token';

test.describe('Card Issuing Flow', () => {
  test.describe.configure({ timeout: 60000 });

  test('should issue card and show card activity', async ({
    page,
    request,
  }) => {
    const testUserEmail = createUniqueEmail('card-user');

    await page.goto(URLS.SIGNUP);
    await page.fill('input[name="email"]', testUserEmail);
    await page.click('button[type="submit"]');

    await page.waitForURL(URLS.DASHBOARD, {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });

    await page.click('text=Add new account');
    await waitForModalToOpen(page, 'modal-content');
    const accountName = createUniqueAccountName('card');
    await page.fill('input#accountName', accountName);
    await page.click('button[type="submit"]');
    await waitForModalToClose(page, 'modal-content');

    await page.click('text=Fund Account');
    await waitForModalToOpen(page, 'modal-content');
    await page.fill('input#amount', '50.00');
    await page.click('button[type="submit"]');
    await waitForTransferCompletion(page);
    await page.click('text=Home');
    await waitForModalToClose(page, 'modal-content');

    await page.getByRole('link', { name: 'Cards' }).click();
    await page.waitForURL('**/cards', {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });

    await page.getByRole('button', { name: 'Issue Card' }).click();
    await waitForModalToOpen(page, 'issue-card-modal-content');

    await page
      .locator('[data-testid="issue-card-modal-content"]')
      .getByRole('button', { name: 'Issue Card' })
      .click();

    await expect(page.getByTestId('issued-card-pan')).toBeVisible();

    const pan = (await page.getByTestId('issued-card-pan').textContent())
      ?.trim()
      .replace(/\s/g, '');
    const cvc = (await page.getByTestId('issued-card-cvc').textContent())
      ?.trim()
      .replace(/\s/g, '');
    const expiryText = (
      await page.getByTestId('issued-card-expiry').textContent()
    )?.trim();

    expect(pan).toBeTruthy();
    expect(cvc).toBeTruthy();
    expect(expiryText).toBeTruthy();

    const [expiryMonthRaw, expiryYearRaw] = (expiryText ?? '').split('/');
    const expiryMonth = Number.parseInt(expiryMonthRaw, 10);
    const expiryYear = 2000 + Number.parseInt(expiryYearRaw, 10);

    const last4 = pan?.slice(-4) ?? '';

    await page
      .locator('[data-testid="issue-card-modal-content"]')
      .getByRole('button', { name: 'Done' })
      .click();
    await waitForModalToClose(page, 'issue-card-modal-content');

    const processorChargeId = `ch_${Date.now()}`;
    const authResponse = await request.post(
      `${BANK_API_URL}/v1/card-processor/authorizations`,
      {
        headers: {
          Authorization: `Bearer ${PROCESSOR_TOKEN}`,
          'idempotency-key': `auth-${Date.now()}`,
          origin: DEFAULT_TEST_ORIGIN,
        },
        data: {
          pan,
          expiryMonth,
          expiryYear,
          cvc,
          amountMinor: 1_200,
          currency: 'USD',
          merchant: {
            name: 'Demo Shop',
            statementDescriptor: 'DEMO SHOP',
          },
          processorChargeId,
        },
      }
    );

    expect(authResponse.ok()).toBeTruthy();
    const authBody = await authResponse.json();
    expect(authBody.status).toBe('APPROVED');

    const captureResponse = await request.post(
      `${BANK_API_URL}/v1/card-processor/authorizations/${authBody.authorizationId}/capture`,
      {
        headers: {
          Authorization: `Bearer ${PROCESSOR_TOKEN}`,
          'idempotency-key': `capture-${Date.now()}`,
          origin: DEFAULT_TEST_ORIGIN,
        },
        data: {
          amountMinor: 1_200,
        },
      }
    );

    expect(captureResponse.ok()).toBeTruthy();

    await page.getByRole('link', { name: 'Overview' }).click();
    await page.waitForURL('**/dashboard', {
      timeout: TEST_DATA.TIMEOUTS.NAVIGATION,
    });

    const history = page.getByTestId('transaction-history-list');
    await expect(history.getByText('Demo Shop').first()).toBeVisible({
      timeout: TEST_DATA.TIMEOUTS.BALANCE_UPDATE,
    });
    await expect(
      history.getByText(`Card: **** ${last4}`).first()
    ).toBeVisible();
  });
});
