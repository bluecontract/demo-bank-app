import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PayNoteLiveTestContext } from '../lib/testContext';
import { createPayNoteLiveTestContext } from '../lib/testContext';
import { createFundedCustomerWithCard } from '../lib/scenarioSetup';
import { FAST_AMOUNTS } from '../lib/amounts';
import {
  buildCardDeliveryDocument,
  buildWebhookEnvelope,
} from '../lib/simplePayNoteBuilders';

describe('PayNote smoke: webhook fallback fetch-by-id', () => {
  let context: PayNoteLiveTestContext;

  beforeAll(async () => {
    context = await createPayNoteLiveTestContext();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('accepts body {id}, fetches the event from MyOS, and remains idempotent on replay', async () => {
    const customer = await createFundedCustomerWithCard(context.bank, {
      prefix: 'pn-fetch-id-smoke',
      accountName: 'PayNote fetch-by-id smoke account',
      fundingAmountMinor:
        FAST_AMOUNTS.cardPurchaseMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    const auth = await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      merchantId: 'merchant-fetch-by-id-demo',
      merchantName: 'PayNote Demo Shop',
    });

    expect(auth.cardTransactionDetails).toBeDefined();

    const sessionId = `paynote-fetch-by-id-session-${randomUUID()}`;
    const documentId = `paynote-fetch-by-id-doc-${randomUUID()}`;
    const eventId = `myos-fetch-id-event-${randomUUID()}`;

    const deliveryDocument = buildCardDeliveryDocument({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      cardTransactionDetails: auth.cardTransactionDetails,
    });

    const payload = buildWebhookEnvelope({
      eventId,
      sessionId,
      eventType: 'DOCUMENT_CREATED',
      document: deliveryDocument,
    });

    context.myOs.seedEvent({ eventId, payload });
    context.myOs.seedDocument({
      documentId,
      sessionId,
      document: deliveryDocument,
    });

    await context.bank.postPayNoteWebhookById(eventId);
    await context.myOs.waitForFetchEvent(call => call.eventId === eventId);

    const firstDelivery = await context.waitForRawDeliveryBySessionId(
      sessionId
    );
    expect(firstDelivery.deliverySessionId).toBe(sessionId);
    expect(firstDelivery.transactionIdentificationStatus).toBe('identified');

    await context.bank.postPayNoteWebhookById(eventId);

    const secondDelivery = await context.waitForRawDeliveryBySessionId(
      sessionId
    );

    expect(secondDelivery.deliveryId).toBe(firstDelivery.deliveryId);
    expect(
      context.myOs
        .listFetchEventCalls()
        .filter(call => call.eventId === eventId).length
    ).toBeGreaterThanOrEqual(2);
  });
});
