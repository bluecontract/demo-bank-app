import { afterAll, beforeAll, describe, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BankTestDriver } from '../lib/BankTestDriver';
import { MyOsHarness } from '../lib/MyOsHarness';
import {
  applyPayNoteIntegrationTestEnv,
  upsertMyOsCredentialsSecret,
  upsertOpenAiPlaceholderSecret,
} from '../lib/localstackSecrets';
import { createFundedCustomerWithCard } from '../lib/scenarioSetup';
import { FAST_AMOUNTS } from '../lib/amounts';
import { waitForNoDuplicateActivityAfterReplay } from '../lib/assertions';
import {
  buildSimpleCardTransactionPayNote,
  buildWebhookEnvelope,
  emittedCaptureFundsRequested,
} from '../lib/simplePayNoteBuilders';

describe('PayNote resilience: idempotency and ordering', () => {
  let bank: BankTestDriver;
  let myOs: MyOsHarness;

  beforeAll(async () => {
    applyPayNoteIntegrationTestEnv();
    bank = new BankTestDriver();
    myOs = new MyOsHarness();
    await myOs.start();

    await upsertMyOsCredentialsSecret({
      secretArn:
        process.env.MYOS_SECRET_ARN ??
        '/demo-bank-app/integration-test/myos-credentials',
      baseUrl: myOs.baseUrl,
      apiKey: myOs.apiKey,
      accountId: 'integration-myos-account-id',
    });
    await upsertOpenAiPlaceholderSecret(
      process.env.OPENAI_API_KEY_SECRET_ARN ??
        '/demo-bank-app/integration-test/openai-api-key'
    );
  });

  afterAll(async () => {
    await myOs.stop();
  });

  it('replaying the same event id should not duplicate financial effects', async () => {
    const customer = await createFundedCustomerWithCard(bank, {
      prefix: 'pn-idempotency-customer',
      fundingAmountMinor:
        FAST_AMOUNTS.cardPurchaseMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    const auth = await bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      merchantId: 'merchant-idempotency-demo',
      merchantName: 'Idempotency Demo Shop',
    });

    const sessionId = `idempotency-session-${randomUUID()}`;
    const documentId = `idempotency-doc-${randomUUID()}`;
    const eventId = `idempotency-event-${randomUUID()}`;

    const document = buildSimpleCardTransactionPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
    });

    myOs.seedDocument({
      documentId,
      sessionId,
      document: {
        type: 'PayNote/PayNote Delivery',
        payNoteDocumentId: documentId,
        payNote: document,
      },
    });

    const webhookPayload = buildWebhookEnvelope({
      eventId,
      sessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 2,
      document: {
        type: 'PayNote/PayNote Delivery',
        payNoteDocumentId: documentId,
        payNote: document,
      },
      emitted: [
        emittedCaptureFundsRequested(
          FAST_AMOUNTS.cardPurchaseMinor,
          'idem-capture'
        ),
      ],
    });

    myOs.seedEvent({
      eventId,
      payload: webhookPayload,
    });

    await bank.postPayNoteWebhookPayload(webhookPayload);
    await bank.postPayNoteWebhookPayload(webhookPayload);

    await waitForNoDuplicateActivityAfterReplay({
      bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      processorChargeId: auth.processorChargeId,
      stablePeriodMs: 5_000,
    });
  });
});
