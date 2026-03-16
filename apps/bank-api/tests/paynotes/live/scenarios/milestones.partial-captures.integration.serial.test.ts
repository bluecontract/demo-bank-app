import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PayNoteLiveTestContext } from '../lib/testContext';
import { createPayNoteLiveTestContext } from '../lib/testContext';
import { DEFAULT_TEST_ORIGIN, invokeBankApi } from '../lib/invokeBankApi';
import { bankRoutes } from '../lib/BankTestDriver';
import {
  createFundedCustomerWithCard,
  requiredFundingForMilestones,
} from '../lib/scenarioSetup';
import { FAST_AMOUNTS } from '../lib/amounts';
import { createScenarioRunContext, logScenarioStep } from '../lib/reporting';
import {
  waitForNoDuplicatePayNoteCaptureSequenceAfterReplay,
  waitForPayNoteCaptureSequence,
} from '../lib/assertions';
import { materializeContractSummaryForWebhook } from '../lib/summaryWorker';
import {
  buildScaledMilestonesDeliveryDocument,
  buildScaledMilestonesPayNote,
  buildWebhookEnvelope,
  emittedCaptureFundsRequested,
  emittedCustomerActionRequested,
} from '../lib/simplePayNoteBuilders';

const milestoneDefinitions = [
  {
    number: 1,
    requestId: 'contractor-m1-action',
    title: 'Milestone 1 Confirmation',
    message: 'Confirm completion of milestone 1.',
    approvalLabel: 'Approve milestone 1',
    captureRequestId: 'contractor-m1',
    amountMinor: FAST_AMOUNTS.scaledMilestoneCapturesMinor[0],
  },
  {
    number: 2,
    requestId: 'contractor-m2-action',
    title: 'Milestone 2 Confirmation',
    message: 'Confirm completion of milestone 2.',
    approvalLabel: 'Approve milestone 2',
    captureRequestId: 'contractor-m2',
    amountMinor: FAST_AMOUNTS.scaledMilestoneCapturesMinor[1],
  },
  {
    number: 3,
    requestId: 'contractor-m3-action',
    title: 'Milestone 3 Confirmation',
    message: 'Confirm completion of milestone 3.',
    approvalLabel: 'Approve milestone 3',
    captureRequestId: 'contractor-m3',
    amountMinor: FAST_AMOUNTS.scaledMilestoneCapturesMinor[2],
  },
  {
    number: 4,
    requestId: 'contractor-m4-action',
    title: 'Milestone 4 Confirmation',
    message: 'Confirm completion of milestone 4.',
    approvalLabel: 'Approve milestone 4',
    captureRequestId: 'contractor-m4',
    amountMinor: FAST_AMOUNTS.scaledMilestoneCapturesMinor[3],
  },
] as const;

const findPendingContractActions = (contract: {
  pendingActions?: Array<{
    status?: string;
    title?: string;
    actionId?: string;
  }>;
}) =>
  (contract.pendingActions ?? []).filter(action => action.status === 'pending');

describe('PayNote live scenario: milestones partial captures', () => {
  let context: PayNoteLiveTestContext;

  beforeAll(async () => {
    context = await createPayNoteLiveTestContext();
  });

  afterAll(async () => {
    await context.cleanup();
  });

  it('captures each milestone after matching customer approval without duplicates', async () => {
    const ctx = createScenarioRunContext('milestones-partial-captures');
    await context.bank.signUpUniqueTestUser('pn-milestones-merchant', true, {
      merchantId: 'merchant-milestones-demo',
      merchantName: 'Milestones Demo Shop',
    });
    const customer = await createFundedCustomerWithCard(context.bank, {
      prefix: 'pn-milestones-customer',
      accountName: 'Milestones card account',
      fundingAmountMinor: requiredFundingForMilestones(),
    });

    const auth = await context.bank.authorizeCard({
      pan: customer.card.pan,
      expiryMonth: customer.card.expiryMonth,
      expiryYear: customer.card.expiryYear,
      cvc: customer.card.cvc,
      amountMinor: FAST_AMOUNTS.scaledMilestoneCapturesMinor.reduce(
        (sum, amountMinor) => sum + amountMinor,
        0
      ),
      merchantId: 'merchant-milestones-demo',
      merchantName: 'Milestones Demo Shop',
    });

    expect(auth.cardTransactionDetails).toBeDefined();

    const deliverySessionId = `milestones-delivery-session-${randomUUID()}`;
    const deliveryDocumentId = `milestones-delivery-doc-${randomUUID()}`;
    const payNoteSessionId = `milestones-root-session-${randomUUID()}`;
    const payNoteDocumentId = `milestones-root-doc-${randomUUID()}`;
    const deliveryEventId = `milestones-delivery-event-${randomUUID()}`;
    const deliveryBootstrapEventId = `milestones-bootstrap-${randomUUID()}`;
    const payNoteCreatedEventId = `milestones-created-${randomUUID()}`;

    const initialPayNoteDocument = buildScaledMilestonesPayNote({
      customerAccountId: customer.account.accountId,
      merchantAccountId: 'merchant-account-id',
      cardTransactionDetails: auth.cardTransactionDetails,
    });
    const deliveryDocument = buildScaledMilestonesDeliveryDocument({
      merchantAccountId: 'merchant-account-id',
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
      document: initialPayNoteDocument,
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
      document: initialPayNoteDocument,
      emitted: [
        emittedCustomerActionRequested({
          requestId: milestoneDefinitions[0].requestId,
          title: milestoneDefinitions[0].title,
          message: milestoneDefinitions[0].message,
          actions: [
            {
              label: milestoneDefinitions[0].approvalLabel,
              variant: 'primary',
            },
          ],
        }),
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
      JSON.stringify(call.body).includes('Demo Milestones')
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
    expect(contract.sessionId).toBe(payNoteSessionId);
    expect(contract.currentSummaryEpoch).toBe(0);
    let activePendingActions = findPendingContractActions(contract);
    expect(activePendingActions).toHaveLength(1);
    expect(activePendingActions[0]?.title).toBe(milestoneDefinitions[0].title);

    const milestoneEventPayloads = milestoneDefinitions.map(
      (milestone, index) => {
        const nextMilestone = milestoneDefinitions[index + 1];
        const updatedDocument = buildScaledMilestonesPayNote({
          customerAccountId: customer.account.accountId,
          merchantAccountId: 'merchant-account-id',
          cardTransactionDetails: auth.cardTransactionDetails,
          completedMilestones: index + 1,
        });

        return buildWebhookEnvelope({
          eventId: `milestones-epoch-${index + 1}-${randomUUID()}`,
          sessionId: payNoteSessionId,
          eventType: 'DOCUMENT_EPOCH_ADVANCED',
          epoch: index + 2,
          triggeredBy: {
            type: 'Conversation/Customer Action Responded',
            epoch: index + 2,
            inResponseTo: {
              requestId: milestone.requestId,
            },
            actionLabel: milestone.approvalLabel,
          },
          document: updatedDocument,
          emitted: [
            emittedCaptureFundsRequested(
              milestone.amountMinor,
              milestone.captureRequestId
            ),
            ...(nextMilestone
              ? [
                  emittedCustomerActionRequested({
                    requestId: nextMilestone.requestId,
                    title: nextMilestone.title,
                    message: nextMilestone.message,
                    actions: [
                      {
                        label: nextMilestone.approvalLabel,
                        variant: 'primary',
                      },
                    ],
                  }),
                ]
              : []),
          ],
        });
      }
    );

    for (const [index, milestone] of milestoneDefinitions.entries()) {
      const pendingActionId = activePendingActions[0]?.actionId;
      expect(pendingActionId).toBeTruthy();

      logScenarioStep(ctx, 'deciding-milestone-pending-action', {
        milestone: milestone.number,
        payNoteSessionId,
        actionId: pendingActionId,
      });
      const decisionResponse = await invokeBankApi({
        method: 'POST',
        path: bankRoutes.decideContractPendingAction(
          payNoteSessionId,
          pendingActionId!
        ),
        jwtCookie: customer.user.jwtCookie,
        headers: { origin: DEFAULT_TEST_ORIGIN },
        body: {
          kind: 'selectOption',
          input: milestone.approvalLabel,
        },
      });
      expect(
        [200, 202],
        JSON.stringify({
          milestone: milestone.number,
          statusCode: decisionResponse.statusCode,
          body: decisionResponse.body,
          activePendingActions,
        })
      ).toContain(decisionResponse.statusCode);
      await context.myOs.waitForOperationCall(
        call =>
          call.sessionId === payNoteSessionId &&
          call.operation === 'guarantorUpdate'
      );

      logScenarioStep(ctx, 'posting-milestone-webhook', {
        milestone: milestone.number,
        payNoteSessionId,
      });
      await context.bank.postPayNoteWebhookPayload(
        milestoneEventPayloads[index]
      );

      if (index < milestoneDefinitions.length - 1) {
        await materializeContractSummaryForWebhook({
          context,
          sessionId: payNoteSessionId,
          payload: milestoneEventPayloads[index],
        });
        contract = await context.bank.waitForContract(
          customer.user.jwtCookie,
          payNoteSessionId
        );
        expect(contract.currentSummaryEpoch).toBe(index + 2);
        activePendingActions = findPendingContractActions(contract);
        expect(activePendingActions).toHaveLength(1);
        expect(activePendingActions[0]?.title).toBe(
          milestoneDefinitions[index + 1].title
        );
      }
    }

    const rawPayNoteAfterFinalCapture = await context.getRawPayNoteBySessionId(
      payNoteSessionId
    );
    expect(rawPayNoteAfterFinalCapture).toBeTruthy();
    expect(rawPayNoteAfterFinalCapture?.holdId).toBeTruthy();
    expect(rawPayNoteAfterFinalCapture?.transactionId).toBeTruthy();

    await waitForPayNoteCaptureSequence({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      payNoteDocumentId,
      expectedCaptureAmountsMinor: FAST_AMOUNTS.scaledMilestoneCapturesMinor,
    });

    await context.bank.postPayNoteWebhookPayload(
      milestoneEventPayloads[milestoneEventPayloads.length - 1]
    );
    await waitForNoDuplicatePayNoteCaptureSequenceAfterReplay({
      bank: context.bank,
      jwtCookie: customer.user.jwtCookie,
      accountNumber: customer.account.accountNumber,
      payNoteDocumentId,
      expectedCaptureAmountsMinor: FAST_AMOUNTS.scaledMilestoneCapturesMinor,
      stablePeriodMs: 5_000,
    });
  });
});
