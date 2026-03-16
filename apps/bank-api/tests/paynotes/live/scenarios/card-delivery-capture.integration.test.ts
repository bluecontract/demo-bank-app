import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PayNoteLiveTestContext } from '../lib/testContext';
import { createPayNoteLiveTestContext } from '../lib/testContext';
import { createFundedCustomerWithCard } from '../lib/scenarioSetup';
import { FAST_AMOUNTS } from '../lib/amounts';
import { createScenarioRunContext, logScenarioStep } from '../lib/reporting';
import {
  waitForNoDuplicatePayNoteCaptureSequenceAfterReplay,
  waitForNoDuplicateActivityAfterReplay,
  waitForPayNoteCaptureSequence,
  waitForSinglePostedCapture,
} from '../lib/assertions';
import { waitForExpectWithLogging } from '../lib/wait';
import {
  buildCardDeliveryDocument,
  buildCardTransactionPayNote,
  buildWebhookEnvelope,
  emittedCaptureFundsRequested,
} from '../lib/simplePayNoteBuilders';

describe('PayNote live scenario: card delivery accepted then capture', () => {
  let context: PayNoteLiveTestContext;

  beforeAll(async () => {
    context = await createPayNoteLiveTestContext();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('posts full webhook payload, persists delivery, accepts it, and captures funds exactly once', async () => {
    const ctx = createScenarioRunContext('card-delivery-capture');
    await context.bank.signUpUniqueTestUser('pn-card-merchant', true, {
      merchantId: 'merchant-paynote-demo',
      merchantName: 'PayNote Demo Shop',
    });
    const customer = await createFundedCustomerWithCard(context.bank, {
      prefix: 'pn-card-customer',
      accountName: 'PayNote card account',
      fundingAmountMinor:
        FAST_AMOUNTS.cardPurchaseMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    const auth = await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      merchantId: 'merchant-paynote-demo',
      merchantName: 'PayNote Demo Shop',
    });

    expect(auth.cardTransactionDetails).toBeDefined();

    const deliverySessionId = `paynote-delivery-session-${randomUUID()}`;
    const deliveryDocumentId = `paynote-delivery-doc-${randomUUID()}`;
    const payNoteSessionId = `paynote-root-session-${randomUUID()}`;
    const payNoteDocumentId = `paynote-root-doc-${randomUUID()}`;
    const deliveryEventId = `myos-delivery-event-${randomUUID()}`;
    const deliveryBootstrapEventId = `myos-delivery-bootstrap-${randomUUID()}`;
    const payNoteCreatedEventId = `myos-paynote-created-${randomUUID()}`;
    const captureEventId = `myos-capture-event-${randomUUID()}`;

    const payNoteDocument = buildCardTransactionPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      cardTransactionDetails: auth.cardTransactionDetails,
    });

    const deliveryDocument = buildCardDeliveryDocument({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      cardTransactionDetails: auth.cardTransactionDetails,
    });

    context.myOs.seedDocument({
      documentId: deliveryDocumentId,
      sessionId: deliverySessionId,
      document: deliveryDocument,
    });
    context.myOs.seedDocument({
      documentId: payNoteDocumentId,
      sessionId: payNoteSessionId,
      document: payNoteDocument,
    });
    await context.saveBootstrapContext({
      bootstrapSessionId: payNoteSessionId,
      accountNumber: customer.account.accountNumber,
      userId: customer.user.userId,
    });

    const deliveryWebhookPayload = buildWebhookEnvelope({
      eventId: deliveryEventId,
      sessionId: deliverySessionId,
      eventType: 'DOCUMENT_CREATED',
      document: deliveryDocument,
    });

    const captureWebhookPayload = buildWebhookEnvelope({
      eventId: captureEventId,
      sessionId: payNoteSessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 2,
      document: payNoteDocument,
      emitted: [
        emittedCaptureFundsRequested(
          FAST_AMOUNTS.cardPurchaseMinor,
          'card-delivery-capture'
        ),
      ],
    });
    const payNoteCreatedWebhookPayload = buildWebhookEnvelope({
      eventId: payNoteCreatedEventId,
      sessionId: payNoteSessionId,
      eventType: 'DOCUMENT_CREATED',
      document: payNoteDocument,
    });
    const deliveryBootstrapWebhookPayload = buildWebhookEnvelope({
      eventId: deliveryBootstrapEventId,
      sessionId: deliverySessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 2,
      document: deliveryDocument,
      emitted: [
        {
          type: 'Conversation/Document Bootstrap Requested',
          bootstrapAssignee: 'payNoteDeliverer',
          channelBindings: {
            payeeChannel: { accountId: 'merchant-account-id' },
            cardProcessorChannel: { accountId: 'processor-account' },
          },
          document: (deliveryDocument.payNoteBootstrapRequest as any)?.document,
        },
      ],
    });

    logScenarioStep(ctx, 'posting-delivery-webhook', {
      deliveryEventId,
      deliverySessionId,
      payNoteSessionId,
      payNoteDocumentId,
    });
    await context.bank.postPayNoteWebhookPayload(deliveryWebhookPayload);

    const delivery = await context.waitForRawDeliveryBySessionId(
      deliverySessionId
    );
    expect(delivery.deliverySessionId).toBe(deliverySessionId);
    expect(delivery.transactionIdentificationStatus).toBe('identified');
    expect(delivery.userId).toBe(customer.user.userId);

    logScenarioStep(ctx, 'accepting-delivery', {
      deliverySessionId,
    });
    await context.bank.acceptDelivery(
      customer.user.jwtCookie,
      deliverySessionId
    );

    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === deliverySessionId &&
        call.operation === 'acceptPayNote'
    );
    context.myOs.queueBootstrapResponse({
      status: 200,
      body: { sessionId: payNoteSessionId },
    });
    await context.bank.postPayNoteWebhookPayload(
      deliveryBootstrapWebhookPayload
    );
    await context.myOs.waitForBootstrapCall(call =>
      JSON.stringify(call.body).includes('Simple Card Capture')
    );

    logScenarioStep(ctx, 'posting-capture-webhook', {
      captureEventId,
      payNoteSessionId,
    });
    await context.bank.postPayNoteWebhookPayload(payNoteCreatedWebhookPayload);
    await context.bank.postPayNoteWebhookPayload(captureWebhookPayload);

    await waitForPayNoteCaptureSequence({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      payNoteDocumentId,
      expectedCaptureAmountsMinor: [FAST_AMOUNTS.cardPurchaseMinor],
    });

    let rawPayNoteAfterCapture:
      | Awaited<ReturnType<PayNoteLiveTestContext['getRawPayNoteBySessionId']>>
      | undefined;
    await waitForExpectWithLogging(
      async () => {
        rawPayNoteAfterCapture = await context.getRawPayNoteBySessionId(
          payNoteSessionId
        );
        expect(rawPayNoteAfterCapture).toBeTruthy();
        expect(rawPayNoteAfterCapture?.holdId).toBeTruthy();
        expect(rawPayNoteAfterCapture?.transactionId).toBeTruthy();
      },
      20_000,
      500,
      'raw-paynote-after-capture'
    );

    expect(rawPayNoteAfterCapture).toBeTruthy();
    expect(rawPayNoteAfterCapture?.holdId).toBeTruthy();
    expect(rawPayNoteAfterCapture?.transactionId).toBeTruthy();
    if (
      !rawPayNoteAfterCapture?.holdId ||
      !rawPayNoteAfterCapture.transactionId
    ) {
      throw new Error(
        'Expected captured PayNote to persist holdId and transactionId'
      );
    }

    await waitForSinglePostedCapture({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      holdId: rawPayNoteAfterCapture.holdId,
      transactionId: rawPayNoteAfterCapture.transactionId,
    });

    await context.bank.postPayNoteWebhookPayload(captureWebhookPayload);
    await waitForNoDuplicatePayNoteCaptureSequenceAfterReplay({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      payNoteDocumentId,
      expectedCaptureAmountsMinor: [FAST_AMOUNTS.cardPurchaseMinor],
      stablePeriodMs: 5_000,
    });
    await waitForNoDuplicateActivityAfterReplay({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      holdId: rawPayNoteAfterCapture.holdId,
      transactionId: rawPayNoteAfterCapture.transactionId,
      stablePeriodMs: 5_000,
    });
  });
});
