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
import {
  buildCardDeliveryDocument,
  buildCardTransactionPayNote,
  buildSubscriptionMandateDocument,
  buildWebhookEnvelope,
} from '../lib/simplePayNoteBuilders';

describe('PayNote live scenario: voucher monitoring and cashback', () => {
  let context: PayNoteLiveTestContext;

  beforeAll(async () => {
    context = await createPayNoteLiveTestContext();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('approves monitoring, reports a monitored transaction, and starts linked cashback exactly once', async () => {
    const ctx = createScenarioRunContext('voucher-monitoring');
    await context.bank.signUpUniqueTestUser('pn-voucher-merchant', true, {
      merchantId: 'merchant-voucher-demo',
      merchantName: 'Voucher Demo Shop',
    });
    const customer = await createFundedCustomerWithCard(context.bank, {
      prefix: 'pn-voucher-customer',
      accountName: 'Voucher monitoring card account',
      fundingAmountMinor:
        FAST_AMOUNTS.cardPurchaseMinor +
        FAST_AMOUNTS.voucherReserveMinor * 2 +
        FAST_AMOUNTS.fundingBufferMinor,
    });

    const auth = await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      merchantId: 'merchant-voucher-demo',
      merchantName: 'Voucher Demo Shop',
    });

    expect(auth.cardTransactionDetails).toBeDefined();

    const deliverySessionId = `voucher-delivery-session-${randomUUID()}`;
    const deliveryDocumentId = `voucher-delivery-doc-${randomUUID()}`;
    const payNoteSessionId = `voucher-root-session-${randomUUID()}`;
    const payNoteDocumentId = `voucher-root-doc-${randomUUID()}`;
    const mandateSessionId = `voucher-mandate-session-${randomUUID()}`;
    const mandateDocumentId = `voucher-mandate-doc-${randomUUID()}`;
    const linkedVoucherSessionId = `voucher-linked-session-${randomUUID()}`;
    const linkedVoucherDocumentId = `voucher-linked-doc-${randomUUID()}`;
    const deliveryEventId = `voucher-delivery-event-${randomUUID()}`;
    const deliveryBootstrapEventId = `voucher-bootstrap-${randomUUID()}`;
    const payNoteCreatedEventId = `voucher-created-${randomUUID()}`;
    const mandateCreatedEventId = `voucher-mandate-created-${randomUUID()}`;
    const linkedCashbackEventId = `voucher-linked-cashback-${randomUUID()}`;
    const linkedCashbackReplayEventId = `voucher-linked-cashback-replay-${randomUUID()}`;
    const linkedChargeAttemptId = [
      payNoteDocumentId,
      linkedCashbackEventId,
      '0',
    ].join(':');

    const payNoteDocument = buildCardTransactionPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      cardTransactionDetails: auth.cardTransactionDetails,
      paymentMandateDocumentId: mandateDocumentId,
    });
    const deliveryDocument = buildCardDeliveryDocument({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.cardPurchaseMinor,
      cardTransactionDetails: auth.cardTransactionDetails,
      paymentMandateDocumentId: mandateDocumentId,
    });
    const baseMandateDocument = {
      ...buildSubscriptionMandateDocument({
        customerUserId: customer.user.userId,
        merchantId: 'merchant-voucher-demo',
        amountLimitMinor: FAST_AMOUNTS.voucherReserveMinor,
        allowLinkedPayNote: true,
      }),
      initialized: {
        documentId: {
          value: mandateDocumentId,
        },
      },
    };
    const approvedMandateDocument = {
      ...buildSubscriptionMandateDocument({
        customerUserId: customer.user.userId,
        merchantId: 'merchant-voucher-demo',
        amountLimitMinor: FAST_AMOUNTS.voucherReserveMinor,
        allowLinkedPayNote: true,
        approvedChargeAttemptId: linkedChargeAttemptId,
      }),
      initialized: {
        documentId: {
          value: mandateDocumentId,
        },
      },
    };
    const linkedVoucherDocument = {
      type: 'PayNote/Merchant To Customer PayNote',
      name: 'Linked Cashback Voucher',
      currency: 'USD',
      amount: {
        total: FAST_AMOUNTS.voucherReserveMinor,
      },
      voucher: {
        merchantId: 'merchant-voucher-demo',
      },
      contracts: {
        payerChannel: {
          type: 'MyOS/MyOS Timeline Channel',
        },
        payeeChannel: {
          type: 'MyOS/MyOS Timeline Channel',
        },
        guarantorChannel: {
          type: 'MyOS/MyOS Timeline Channel',
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
      document: payNoteDocument,
    });
    context.myOs.seedDocument({
      documentId: mandateDocumentId,
      sessionId: mandateSessionId,
      document: baseMandateDocument,
    });
    context.myOs.seedDocument({
      documentId: linkedVoucherDocumentId,
      sessionId: linkedVoucherSessionId,
      document: linkedVoucherDocument,
    });
    await context.saveBootstrapContext({
      bootstrapSessionId: payNoteSessionId,
      accountNumber: customer.account.accountNumber,
      userId: customer.user.userId,
    });
    await context.saveBootstrapContext({
      bootstrapSessionId: mandateSessionId,
      accountNumber: customer.account.accountNumber,
      userId: customer.user.userId,
    });

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
      document: payNoteDocument,
      emitted: [
        {
          type: 'PayNote/Start Card Transaction Monitoring Requested',
          requestId: 'voucher-monitoring',
          targetMerchantId: 'merchant-voucher-demo',
          events: ['transaction'],
        },
      ],
    });
    const linkedCashbackWebhookPayload = buildWebhookEnvelope({
      eventId: linkedCashbackEventId,
      sessionId: payNoteSessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 2,
      document: payNoteDocument,
      emitted: [
        {
          type: 'PayNote/Linked Card Charge and Capture Immediately Requested',
          requestId: 'voucher-linked-cashback',
          name: 'Linked cashback voucher',
          description: 'Issue cashback after the monitored merchant purchase.',
          amount: FAST_AMOUNTS.voucherReserveMinor,
          paymentMandateDocumentId: mandateDocumentId,
          paynote: linkedVoucherDocument,
        },
      ],
    });
    const linkedCashbackReplayWebhookPayload = buildWebhookEnvelope({
      eventId: linkedCashbackReplayEventId,
      sessionId: payNoteSessionId,
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      epoch: 2,
      document: payNoteDocument,
      emitted: [
        {
          type: 'PayNote/Linked Card Charge and Capture Immediately Requested',
          requestId: 'voucher-linked-cashback',
          name: 'Linked cashback voucher',
          description: 'Issue cashback after the monitored merchant purchase.',
          amount: FAST_AMOUNTS.voucherReserveMinor,
          paymentMandateDocumentId: mandateDocumentId,
          paynote: linkedVoucherDocument,
        },
      ],
    });
    const mandateCreatedWebhookPayload = buildWebhookEnvelope({
      eventId: mandateCreatedEventId,
      sessionId: mandateSessionId,
      eventType: 'DOCUMENT_CREATED',
      document: baseMandateDocument,
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
      JSON.stringify(call.body).includes('Simple Card Capture')
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
    const monitoringPendingAction = (contract.pendingActions ?? []).find(
      (action: any) =>
        action.status === 'pending' &&
        action.type === 'monitoringConsentApproval'
    );
    expect(monitoringPendingAction).toBeTruthy();

    logScenarioStep(ctx, 'approving-monitoring', {
      payNoteSessionId,
      actionId: monitoringPendingAction?.actionId,
    });
    await context.bank.decideContractPendingAction(
      customer.user.jwtCookie,
      payNoteSessionId,
      monitoringPendingAction.actionId,
      {
        kind: 'approveReject',
        input: 'accepted',
      }
    );
    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === payNoteSessionId &&
        call.operation === 'guarantorUpdate' &&
        JSON.stringify(call.body).includes('voucher-monitoring')
    );

    logScenarioStep(ctx, 'posting-monitored-card-authorization', {
      payNoteSessionId,
      merchantId: 'merchant-voucher-demo',
    });
    await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.voucherReserveMinor,
      merchantId: 'merchant-voucher-demo',
      merchantName: 'Voucher Demo Shop',
    });
    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === payNoteSessionId &&
        call.operation === 'guarantorUpdate' &&
        JSON.stringify(call.body).includes('PayNote/Card Transaction Report')
    );

    logScenarioStep(ctx, 'posting-mandate-created-webhook', {
      mandateCreatedEventId,
      mandateSessionId,
      mandateDocumentId,
    });
    await context.bank.postPayNoteWebhookPayload(mandateCreatedWebhookPayload);
    const rawMandateContract = await context.getRawContractBySessionId(
      mandateSessionId
    );
    expect(rawMandateContract?.documentId).toBe(mandateDocumentId);

    context.myOs.queueDocumentResponse(mandateSessionId, {
      body: {
        documentId: mandateDocumentId,
        sessionId: mandateSessionId,
        document: baseMandateDocument,
      },
    });
    context.myOs.queueDocumentResponse(mandateSessionId, {
      body: {
        documentId: mandateDocumentId,
        sessionId: mandateSessionId,
        document: approvedMandateDocument,
      },
    });
    context.myOs.queueBootstrapResponse({
      status: 200,
      body: { sessionId: linkedVoucherSessionId },
    });

    logScenarioStep(ctx, 'posting-linked-cashback-webhook', {
      linkedCashbackEventId,
      payNoteSessionId,
      linkedVoucherSessionId,
      linkedVoucherDocumentId,
    });
    await context.bank.postPayNoteWebhookPayload(linkedCashbackWebhookPayload);

    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === mandateSessionId &&
        call.operation === 'authorizeSpend'
    );
    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === mandateSessionId && call.operation === 'settleSpend'
    );
    await context.myOs.waitForBootstrapCall(call =>
      JSON.stringify(call.body).includes('Linked Cashback Voucher')
    );
    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === payNoteSessionId &&
        call.operation === 'guarantorUpdate' &&
        JSON.stringify(call.body).includes('Linked PayNote Started')
    );

    await waitForPayNoteCaptureSequence({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      payNoteDocumentId,
      expectedCaptureAmountsMinor: [FAST_AMOUNTS.voucherReserveMinor],
    });

    await context.bank.postPayNoteWebhookPayload(
      linkedCashbackReplayWebhookPayload
    );
    await waitForNoDuplicatePayNoteCaptureSequenceAfterReplay({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      payNoteDocumentId,
      expectedCaptureAmountsMinor: [FAST_AMOUNTS.voucherReserveMinor],
      stablePeriodMs: 5_000,
    });

    contract = await context.getRawContractBySessionId(payNoteSessionId);
    expect(contract?.monitoringSubscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetMerchantId: 'merchant-voucher-demo',
          status: 'active',
        }),
      ])
    );
  });
});
