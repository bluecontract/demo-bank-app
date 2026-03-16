import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PayNoteLiveTestContext } from '../lib/testContext';
import { createPayNoteLiveTestContext } from '../lib/testContext';
import { createFundedCustomerWithCard } from '../lib/scenarioSetup';
import { FAST_AMOUNTS } from '../lib/amounts';
import { createScenarioRunContext, logScenarioStep } from '../lib/reporting';
import {
  waitForNoDuplicateActivityAfterReplay,
  waitForSinglePostedCapture,
} from '../lib/assertions';
import {
  buildPendingInstallDeliveryDocument,
  buildPendingInstallPayNote,
  buildWebhookEnvelope,
  emittedCaptureFundsRequested,
  emittedCustomerActionRequested,
} from '../lib/simplePayNoteBuilders';

describe('PayNote live scenario: pending installation approval then capture', () => {
  let context: PayNoteLiveTestContext;

  beforeAll(async () => {
    context = await createPayNoteLiveTestContext();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('exposes the pending action, accepts approval, and captures funds exactly once', async () => {
    const ctx = createScenarioRunContext('pending-install-capture');
    await context.bank.signUpUniqueTestUser('pn-install-merchant', true, {
      merchantId: 'merchant-install-demo',
      merchantName: 'Install Demo Shop',
    });
    const customer = await createFundedCustomerWithCard(context.bank, {
      prefix: 'pn-install-customer',
      accountName: 'Pending install card account',
      fundingAmountMinor:
        FAST_AMOUNTS.pendingInstallMinor + FAST_AMOUNTS.fundingBufferMinor,
    });

    const auth = await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.pendingInstallMinor,
      merchantId: 'merchant-install-demo',
      merchantName: 'Install Demo Shop',
    });

    expect(auth.cardTransactionDetails).toBeDefined();

    const deliverySessionId = `pending-install-delivery-session-${randomUUID()}`;
    const deliveryDocumentId = `pending-install-delivery-doc-${randomUUID()}`;
    const payNoteSessionId = `pending-install-root-session-${randomUUID()}`;
    const payNoteDocumentId = `pending-install-root-doc-${randomUUID()}`;
    const deliveryEventId = `pending-install-delivery-event-${randomUUID()}`;
    const deliveryBootstrapEventId = `pending-install-bootstrap-${randomUUID()}`;
    const payNoteCreatedEventId = `pending-install-created-${randomUUID()}`;
    const payNoteCaptureEventId = `pending-install-capture-${randomUUID()}`;

    const payNoteDocument = buildPendingInstallPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.pendingInstallMinor,
      cardTransactionDetails: auth.cardTransactionDetails,
    });
    const approvedPayNoteDocument = {
      ...payNoteDocument,
      state: {
        approved: {
          value: true,
        },
      },
    };
    const deliveryDocument = buildPendingInstallDeliveryDocument({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      amountMinor: FAST_AMOUNTS.pendingInstallMinor,
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
        emittedCustomerActionRequested({
          requestId: 'install-confirmation',
          title: 'Confirm installation',
          message:
            'Confirm the installation to capture the authorized payment.',
          actions: [
            {
              label: 'Installation confirmed',
              variant: 'primary',
            },
          ],
        }),
      ],
    });
    const payNoteCaptureWebhookPayload = buildWebhookEnvelope({
      eventId: payNoteCaptureEventId,
      sessionId: payNoteSessionId,
      document: approvedPayNoteDocument,
      emitted: [
        emittedCaptureFundsRequested(
          FAST_AMOUNTS.pendingInstallMinor,
          'install-capture'
        ),
      ],
      epoch: 1,
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
      JSON.stringify(call.body).includes('Pending Installation Capture')
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
    const contract = await context.bank.waitForContract(
      customer.user.jwtCookie,
      payNoteSessionId
    );
    expect(contract.sessionId).toBe(payNoteSessionId);
    expect(contract.pendingActions).toHaveLength(1);
    expect(contract.pendingActions[0]?.title).toBe('Confirm installation');

    logScenarioStep(ctx, 'deciding-pending-action', {
      payNoteSessionId,
      actionId: contract.pendingActions[0]?.actionId,
    });
    await context.bank.decideContractPendingAction(
      customer.user.jwtCookie,
      payNoteSessionId,
      contract.pendingActions[0].actionId,
      {
        kind: 'selectOption',
        input: 'Installation confirmed',
      }
    );
    await context.myOs.waitForOperationCall(
      call =>
        call.sessionId === payNoteSessionId &&
        call.operation === 'guarantorUpdate' &&
        JSON.stringify(call.body).includes(
          'Conversation/Customer Action Responded'
        )
    );

    logScenarioStep(ctx, 'posting-capture-webhook', {
      payNoteCaptureEventId,
      payNoteSessionId,
    });
    await context.bank.postPayNoteWebhookPayload(payNoteCaptureWebhookPayload);

    const rawPayNoteAfterCapture = await context.getRawPayNoteBySessionId(
      payNoteSessionId
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

    await context.bank.postPayNoteWebhookPayload(payNoteCaptureWebhookPayload);
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
