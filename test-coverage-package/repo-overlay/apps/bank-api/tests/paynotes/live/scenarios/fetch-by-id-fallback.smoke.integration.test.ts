import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import {
  buildSimpleCardTransactionPayNote,
  buildWebhookEnvelope,
  emittedCaptureFundsRequested,
} from '../lib/simplePayNoteBuilders';

/**
 * Small compatibility smoke for the bank's `{ id: eventId }` webhook body.
 * This must stay tiny and secondary.
 * The main live/e2e path should still use full payload pull-and-post.
 */
describe('PayNote smoke: webhook fallback fetch-by-id', () => {
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

  it('accepts body {id}, fetches event from MyOS, and keeps replay idempotent', async () => {
    const customer = await createFundedCustomerWithCard(bank, {
      prefix: 'pn-fetch-id-smoke',
      accountName: 'PayNote fetch-by-id smoke account',
      fundingAmountMinor:
        FAST_AMOUNTS.cardPurchaseMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    await bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      merchantId: 'merchant-paynote-demo',
      merchantName: 'PayNote Demo Shop',
    });

    const sessionId = `paynote-fetch-by-id-session-${randomUUID()}`;
    const documentId = `paynote-fetch-by-id-doc-${randomUUID()}`;
    const eventId = `myos-fetch-id-event-${randomUUID()}`;

    const document = buildSimpleCardTransactionPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
    });

    const deliveryDocument = {
      type: 'PayNote/PayNote Delivery',
      payNoteDocumentId: documentId,
      payNote: document,
    };

    const payload = buildWebhookEnvelope({
      eventId,
      sessionId,
      eventType: 'DOCUMENT_CREATED',
      document: deliveryDocument,
      emitted: [
        emittedCaptureFundsRequested(
          FAST_AMOUNTS.cardPurchaseMinor,
          'fetch-by-id-smoke'
        ),
      ],
    });

    myOs.seedEvent({ eventId, payload });
    myOs.seedDocument({
      documentId,
      sessionId,
      document: deliveryDocument,
    });

    await bank.postPayNoteWebhookById(eventId);

    await myOs.waitForFetchEvent(call => call.eventId === eventId);

    const firstDelivery = await bank.waitForDeliveryBySessionId(
      customer.user.jwtCookie,
      sessionId
    );
    expect(firstDelivery).toBeTruthy();

    await bank.postPayNoteWebhookById(eventId);

    const secondDelivery = await bank.waitForDeliveryBySessionId(
      customer.user.jwtCookie,
      sessionId
    );

    expect(secondDelivery.deliveryId ?? secondDelivery.id).toBe(
      firstDelivery.deliveryId ?? firstDelivery.id
    );
    expect(
      myOs.listFetchEventCalls().filter(call => call.eventId === eventId).length
    ).toBeGreaterThanOrEqual(2);
  });
});
