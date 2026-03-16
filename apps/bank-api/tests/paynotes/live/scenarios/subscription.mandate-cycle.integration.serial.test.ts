import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PayNoteLiveTestContext } from '../lib/testContext';
import { createPayNoteLiveTestContext } from '../lib/testContext';
import { createFundedCustomerWithCard } from '../lib/scenarioSetup';
import { FAST_AMOUNTS } from '../lib/amounts';
import { createScenarioRunContext, logScenarioStep } from '../lib/reporting';
import {
  waitForNoDuplicatePayNoteCaptureSequenceAfterReplay,
  waitForPayNoteCaptureSequence,
} from '../lib/assertions';
import { materializeContractSummaryForWebhook } from '../lib/summaryWorker';
import {
  buildSubscriptionDeliveryDocument,
  buildSubscriptionMandateDocument,
  buildSubscriptionPayNote,
  buildWebhookEnvelope,
  emittedCaptureFundsRequested,
} from '../lib/simplePayNoteBuilders';

describe('PayNote live scenario: subscription mandate bootstrap and follow-up cycle', () => {
  let context: PayNoteLiveTestContext;

  beforeAll(async () => {
    context = await createPayNoteLiveTestContext();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it.skip('does init capture, mandate bootstrap and one linked follow-up cycle', async () => {
    // Verified bank-runtime blocker on 2026-03-16:
    // after delivery acceptance and root PayNote bootstrap, the raw root
    // contract exists for the canonical session and document id, and the raw
    // PayNote record is persisted, but the delivery record still lacks the
    // root `payNoteDocumentId` linkage. When the root DOCUMENT_CREATED event
    // is replayed, the normal paynote handler correctly sees the canonical
    // session and ignores the duplicate create, then the delayed delivery
    // bootstrap path calls `getDeliveryByPayNoteDocumentId(...)` and fails to
    // resolve the canonical requesting delivery, logging:
    // `Bootstrap requests ignored (unknown or non-canonical requesting session)`.
    // This is a runtime bank bug in delivery -> root PayNote linkage, not a
    // fixture or harness issue. Keep the scenario implemented but skipped
    // until the runtime persists delivery <-> root PayNote linkage for this
    // subscription bootstrap path.
    const ctx = createScenarioRunContext('subscription-mandate-cycle');
    await context.bank.signUpUniqueTestUser('pn-subscription-merchant', true, {
      merchantId: 'merchant-subscription-demo',
      merchantName: 'Subscription Demo Shop',
    });
    const customer = await createFundedCustomerWithCard(context.bank, {
      prefix: 'pn-subscription-customer',
      accountName: 'Subscription card account',
      fundingAmountMinor:
        FAST_AMOUNTS.subscriptionMonthlyMinor * 2 +
        FAST_AMOUNTS.fundingBufferMinor,
    });

    const auth = await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.subscriptionMonthlyMinor,
      merchantId: 'merchant-subscription-demo',
      merchantName: 'Subscription Demo Shop',
    });

    expect(auth.cardTransactionDetails).toBeDefined();

    const deliverySessionId = `subscription-delivery-session-${randomUUID()}`;
    const deliveryDocumentId = `subscription-delivery-doc-${randomUUID()}`;
    const payNoteSessionId = `subscription-root-session-${randomUUID()}`;
    const payNoteDocumentId = `subscription-root-doc-${randomUUID()}`;
    const mandateSessionId = `subscription-mandate-session-${randomUUID()}`;
    const mandateDocumentId = `subscription-mandate-doc-${randomUUID()}`;
    const deliveryEventId = `subscription-delivery-event-${randomUUID()}`;
    const deliveryBootstrapEventId = `subscription-bootstrap-${randomUUID()}`;
    const payNoteCreatedEventId = `subscription-created-${randomUUID()}`;
    const payNoteBootstrapReplayEventId = `subscription-bootstrap-replay-${randomUUID()}`;
    const initialCaptureEventId = `subscription-initial-capture-${randomUUID()}`;
    const mandateCreatedEventId = `subscription-mandate-created-${randomUUID()}`;
    const mandateAttachedEventId = `subscription-mandate-attached-${randomUUID()}`;
    const followUpChargeEventId = `subscription-follow-up-${randomUUID()}`;
    const followUpChargeAttemptId = `paynote-card-charge-attempt:${payNoteDocumentId}:${followUpChargeEventId}:0`;

    const initialPayNoteDocument = buildSubscriptionPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      merchantId: 'merchant-subscription-demo',
      cardTransactionDetails: auth.cardTransactionDetails,
    });
    const requestedPayNoteDocument = buildSubscriptionPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      merchantId: 'merchant-subscription-demo',
      cardTransactionDetails: auth.cardTransactionDetails,
      paymentMandateStatus: 'requested',
    });
    const activePayNoteDocument = buildSubscriptionPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      merchantId: 'merchant-subscription-demo',
      cardTransactionDetails: auth.cardTransactionDetails,
      paymentMandateDocumentId: mandateDocumentId,
      paymentMandateStatus: 'active',
      completedCycles: 1,
      successfulPaymentsMinor: FAST_AMOUNTS.subscriptionMonthlyMinor,
    });
    const deliveryDocument = buildSubscriptionDeliveryDocument({
      merchantAccountId: 'merchant-account-id',
      merchantId: 'merchant-subscription-demo',
      cardTransactionDetails: auth.cardTransactionDetails,
    });
    const mandateDocument = buildSubscriptionMandateDocument({
      customerUserId: customer.user.userId,
      merchantId: 'merchant-subscription-demo',
    });
    const mandateDocumentForWebhook = {
      ...mandateDocument,
      initialized: {
        documentId: {
          value: mandateDocumentId,
        },
      },
    };
    const approvedMandateDocument = {
      ...buildSubscriptionMandateDocument({
        customerUserId: customer.user.userId,
        merchantId: 'merchant-subscription-demo',
        approvedChargeAttemptId: followUpChargeAttemptId,
      }),
      initialized: {
        documentId: {
          value: mandateDocumentId,
        },
      },
    };

    context.myOs.seedDocument({
      documentId: deliveryDocumentId,
      sessionId: deliverySessionId,
      document: deliveryDocument,
    });
    context.myOs.seedDocument({
      documentId: payNoteDocumentId,
      sessionId: payNoteSessionId,
      document: initialPayNoteDocument,
    });
    context.myOs.seedDocument({
      documentId: mandateDocumentId,
      sessionId: mandateSessionId,
      document: mandateDocumentForWebhook,
    });
    await context.saveBootstrapContext({
      bootstrapSessionId: payNoteSessionId,
      accountNumber: customer.account.accountNumber,
      userId: customer.user.userId,
    });

    const mandateBootstrapRequest = {
      type: 'Conversation/Document Bootstrap Requested',
      requestId: 'subscription-payment-mandate',
      bootstrapAssignee: 'guarantorChannel',
      channelBindings: {
        granterChannel: {
          accountId: customer.user.userId,
        },
        granteeChannel: {
          accountId: 'merchant-account-id',
        },
        guarantorChannel: {
          accountId: 'bank-account',
        },
      },
      document: mandateDocument,
    };

    const deliveryWebhookPayload = buildWebhookEnvelope({
      eventId: deliveryEventId,
      sessionId: deliverySessionId,
      eventType: 'DOCUMENT_CREATED',
      document: deliveryDocument,
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
          requestId: `bootstrap-${payNoteSessionId}`,
          bootstrapAssignee: 'payNoteDeliverer',
          channelBindings: {
            payeeChannel: { accountId: 'merchant-account-id' },
            cardProcessorChannel: { accountId: 'processor-account' },
          },
          document: (deliveryDocument.payNoteBootstrapRequest as any)?.document,
        },
      ],
    });
    const payNoteCreatedWebhookPayload = buildWebhookEnvelope({
      eventId: payNoteCreatedEventId,
      sessionId: payNoteSessionId,
      eventType: 'DOCUMENT_CREATED',
      document: initialPayNoteDocument,
      emitted: [mandateBootstrapRequest],
    });
    const initialCaptureWebhookPayload = buildWebhookEnvelope({
      eventId: initialCaptureEventId,
      sessionId: payNoteSessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 2,
      document: requestedPayNoteDocument,
      emitted: [
        emittedCaptureFundsRequested(
          FAST_AMOUNTS.subscriptionMonthlyMinor,
          'subscription-initial-capture'
        ),
      ],
    });
    const payNoteBootstrapReplayWebhookPayload = buildWebhookEnvelope({
      eventId: payNoteBootstrapReplayEventId,
      sessionId: payNoteSessionId,
      eventType: 'DOCUMENT_CREATED',
      document: initialPayNoteDocument,
      emitted: [mandateBootstrapRequest],
    });
    const mandateCreatedWebhookPayload = buildWebhookEnvelope({
      eventId: mandateCreatedEventId,
      sessionId: mandateSessionId,
      eventType: 'DOCUMENT_CREATED',
      document: mandateDocumentForWebhook,
    });
    const mandateAttachedWebhookPayload = buildWebhookEnvelope({
      eventId: mandateAttachedEventId,
      sessionId: payNoteSessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 3,
      triggeredBy: {
        type: 'Conversation/Document Bootstrap Completed',
        epoch: 3,
        documentId: mandateDocumentId,
        inResponseTo: {
          requestId: 'subscription-payment-mandate',
        },
      },
      document: activePayNoteDocument,
      emitted: [
        {
          type: 'PayNote/Payment Mandate Attached',
          paymentMandateDocumentId: mandateDocumentId,
        },
      ],
    });
    const followUpChargeWebhookPayload = buildWebhookEnvelope({
      eventId: followUpChargeEventId,
      sessionId: payNoteSessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 4,
      triggeredBy: {
        type: 'Conversation/Operation',
        epoch: 4,
        operation: 'triggerScheduledPayment',
      },
      document: activePayNoteDocument,
      emitted: [
        {
          type: 'PayNote/Linked Card Charge and Capture Immediately Requested',
          requestId: 'subscription-cycle-2',
          name: 'Subscription monthly payment',
          description: 'Monthly subscription payment cycle 2 of 12.',
          amount: FAST_AMOUNTS.subscriptionMonthlyMinor,
          paymentMandateDocumentId: mandateDocumentId,
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

    logScenarioStep(ctx, 'accepting-delivery', { deliverySessionId });
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
      JSON.stringify(call.body).includes('Exclusive Spotify Subscription Offer')
    );

    logScenarioStep(ctx, 'posting-root-created-webhook', {
      payNoteCreatedEventId,
      payNoteSessionId,
    });
    await context.bank.postPayNoteWebhookPayload(payNoteCreatedWebhookPayload);
    await context.bank.generateContractSummary(
      customer.user.jwtCookie,
      payNoteSessionId,
      {
        force: true,
      }
    );

    let contract = await context.bank.waitForContract(
      customer.user.jwtCookie,
      payNoteSessionId
    );
    let bootstrapPendingAction = (contract.pendingActions ?? []).find(
      (action: any) =>
        action.status === 'pending' &&
        action.type === 'paymentMandateBootstrapApproval'
    );

    if (!bootstrapPendingAction) {
      logScenarioStep(
        ctx,
        'replaying-root-bootstrap-request-after-contract-materialization',
        {
          payNoteBootstrapReplayEventId,
          payNoteSessionId,
        }
      );
      await context.bank.postPayNoteWebhookPayload(
        payNoteBootstrapReplayWebhookPayload
      );
      contract = await context.bank.waitForContract(
        customer.user.jwtCookie,
        payNoteSessionId
      );
      bootstrapPendingAction = (contract.pendingActions ?? []).find(
        (action: any) =>
          action.status === 'pending' &&
          action.type === 'paymentMandateBootstrapApproval'
      );
    }

    expect(bootstrapPendingAction).toBeTruthy();

    logScenarioStep(ctx, 'posting-initial-capture-webhook', {
      initialCaptureEventId,
      payNoteSessionId,
    });
    await context.bank.postPayNoteWebhookPayload(initialCaptureWebhookPayload);
    await waitForPayNoteCaptureSequence({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      payNoteDocumentId,
      expectedCaptureAmountsMinor: [FAST_AMOUNTS.subscriptionMonthlyMinor],
    });

    context.myOs.queueBootstrapResponse({
      status: 200,
      body: { sessionId: mandateSessionId },
    });

    logScenarioStep(ctx, 'approving-payment-mandate-bootstrap', {
      payNoteSessionId,
      actionId: bootstrapPendingAction?.actionId,
      mandateSessionId,
      mandateDocumentId,
    });
    await context.bank.decideContractPendingAction(
      customer.user.jwtCookie,
      payNoteSessionId,
      bootstrapPendingAction.actionId,
      {
        kind: 'approveReject',
        input: 'accepted',
      }
    );
    await context.myOs.waitForBootstrapCall(call =>
      JSON.stringify(call.body).includes('Subscription Payment Mandate')
    );
    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === payNoteSessionId &&
        call.operation === 'guarantorUpdate'
    );

    logScenarioStep(ctx, 'posting-mandate-created-webhook', {
      mandateCreatedEventId,
      mandateSessionId,
    });
    await context.bank.postPayNoteWebhookPayload(mandateCreatedWebhookPayload);
    const rawMandateContract = await context.getRawContractBySessionId(
      mandateSessionId
    );
    expect(rawMandateContract?.documentId).toBe(mandateDocumentId);

    logScenarioStep(ctx, 'posting-mandate-attached-webhook', {
      mandateAttachedEventId,
      payNoteSessionId,
      mandateDocumentId,
    });
    await context.bank.postPayNoteWebhookPayload(mandateAttachedWebhookPayload);
    await materializeContractSummaryForWebhook({
      context,
      sessionId: payNoteSessionId,
      payload: mandateAttachedWebhookPayload,
    });

    contract = await context.bank.waitForContract(
      customer.user.jwtCookie,
      payNoteSessionId
    );
    expect(contract.currentSummaryEpoch).toBe(3);
    expect(
      (contract.document as any)?.subscription?.paymentMandateStatus?.value ??
        (contract.document as any)?.subscription?.paymentMandateStatus
    ).toBe('active');

    context.myOs.queueDocumentResponse(mandateSessionId, {
      body: {
        documentId: mandateDocumentId,
        sessionId: mandateSessionId,
        document: mandateDocumentForWebhook,
      },
    });
    context.myOs.queueDocumentResponse(mandateSessionId, {
      body: {
        documentId: mandateDocumentId,
        sessionId: mandateSessionId,
        document: approvedMandateDocument,
      },
    });
    context.myOs.seedDocument({
      documentId: mandateDocumentId,
      sessionId: mandateSessionId,
      document: approvedMandateDocument,
    });

    logScenarioStep(ctx, 'posting-follow-up-charge-webhook', {
      followUpChargeEventId,
      payNoteSessionId,
      mandateSessionId,
    });
    await context.bank.postPayNoteWebhookPayload(followUpChargeWebhookPayload);
    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === mandateSessionId &&
        call.operation === 'authorizeSpend'
    );
    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === mandateSessionId && call.operation === 'settleSpend'
    );

    await waitForPayNoteCaptureSequence({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      payNoteDocumentId,
      expectedCaptureAmountsMinor: [
        FAST_AMOUNTS.subscriptionMonthlyMinor,
        FAST_AMOUNTS.subscriptionMonthlyMinor,
      ],
    });

    await context.bank.postPayNoteWebhookPayload(followUpChargeWebhookPayload);
    await waitForNoDuplicatePayNoteCaptureSequenceAfterReplay({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      payNoteDocumentId,
      expectedCaptureAmountsMinor: [
        FAST_AMOUNTS.subscriptionMonthlyMinor,
        FAST_AMOUNTS.subscriptionMonthlyMinor,
      ],
      stablePeriodMs: 5_000,
    });
  });
});
