import { Blue } from '@blue-labs/language';
import { createDefaultMergingProcessor } from '@blue-labs/document-processor';
import { repository } from '@blue-repository/types';
import conversationBlueIds from '@blue-repository/types/packages/conversation/blue-ids';
import myosBlueIds from '@blue-repository/types/packages/myos/blue-ids';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import { FAST_AMOUNTS } from './amounts';

const blue = new Blue({
  repositories: [repository],
  mergingProcessor: createDefaultMergingProcessor(),
});

export type TestCardTransactionDetails = {
  retrievalReferenceNumber: string;
  systemTraceAuditNumber: string;
  transmissionDateTime: string;
  authorizationCode: string;
};

const DELIVERY_BLUE_ID = paynoteBlueIds['PayNote/PayNote Delivery'];

export const buildMyOsDocumentSessionBootstrap = (input: {
  name?: string;
  initiatorSessionIds?: string[];
}) => {
  const initiatorSessionIdsYaml =
    input.initiatorSessionIds && input.initiatorSessionIds.length > 0
      ? `\ninitiatorSessionIds:\n${input.initiatorSessionIds
          .map(sessionId => `  - ${sessionId}`)
          .join('\n')}`
      : '';
  const node = blue.yamlToNode(
    `name: ${input.name ?? 'Bootstrap'}${initiatorSessionIdsYaml}`
  );
  node.setType(
    blue.jsonValueToNode({
      blueId: myosBlueIds['MyOS/Document Session Bootstrap'],
    })
  );
  return blue.nodeToJson(node) as Record<string, unknown>;
};

export const buildMyOsTargetDocumentSessionStartedEvent = (input: {
  initiatorSessionIds: string[];
  name?: string;
}) => {
  const node = blue.yamlToNode(
    `name: ${
      input.name ?? 'Target Session Started'
    }\ninitiatorSessionIds:\n${input.initiatorSessionIds
      .map(sessionId => `  - ${sessionId}`)
      .join('\n')}`
  );
  node.setType(
    blue.jsonValueToNode({
      blueId: myosBlueIds['MyOS/Target Document Session Started'],
    })
  );
  return blue.nodeToJson(node) as Record<string, unknown>;
};

export const buildWebhookEnvelope = (input: {
  eventId: string;
  sessionId: string;
  document: Record<string, unknown>;
  emitted?: unknown[];
  eventType?: 'DOCUMENT_CREATED' | 'DOCUMENT_EPOCH_ADVANCED';
  epoch?: number;
  createdAt?: string;
  uid?: string;
  blueId?: string;
  triggeredBy?: unknown;
}) => {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const eventType = input.eventType ?? 'DOCUMENT_EPOCH_ADVANCED';
  const epoch = input.epoch ?? 1;

  return {
    id: input.eventId,
    type: eventType,
    uid: input.uid ?? 'test-myos-uid',
    created: createdAt,
    ref:
      eventType === 'DOCUMENT_CREATED'
        ? input.sessionId
        : `${input.sessionId}:${epoch}`,
    object: {
      sessionId: input.sessionId,
      ...(eventType === 'DOCUMENT_CREATED' ? {} : { epoch }),
      created: createdAt,
      blueId: input.blueId ?? `blue-${input.sessionId}`,
      document: input.document,
      emitted: input.emitted ?? [],
      ...(input.triggeredBy === undefined
        ? { triggeredBy: null }
        : { triggeredBy: input.triggeredBy }),
    },
  };
};

export const buildCardTransactionPayNote = (input: {
  customerAccountId: string;
  merchantAccountId: string;
  amountMinor: number;
  cardTransactionDetails: TestCardTransactionDetails;
  paymentMandateDocumentId?: string;
}) => {
  const yaml = `type: PayNote/Card Transaction PayNote
name: Simple Card Capture
LLM_SUMMARY_DISABLED: true
currency: USD
amount:
  total: ${input.amountMinor}
payNoteInitialStateDescription:
  summary: Simple low-value card capture scenario for integration tests.
  details: |
    The document uses the pre-authorized card hold and emits a capture request
    once delivery or approval completes.
  initialMessage: A small card-based PayNote offer is ready for you.
cardTransactionDetails:
  retrievalReferenceNumber: "${
    input.cardTransactionDetails.retrievalReferenceNumber
  }"
  systemTraceAuditNumber: "${
    input.cardTransactionDetails.systemTraceAuditNumber
  }"
  transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
  authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
contracts:
  payerChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.customerAccountId}
  payeeChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.merchantAccountId}
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
  guarantorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
${
  input.paymentMandateDocumentId
    ? `paymentMandateDocumentId: "${input.paymentMandateDocumentId}"`
    : ''
}
`;

  return blue.nodeToJson(blue.yamlToNode(yaml)) as Record<string, unknown>;
};

export const buildCardDeliveryDocument = (input: {
  customerAccountId: string;
  merchantAccountId: string;
  amountMinor: number;
  cardTransactionDetails: TestCardTransactionDetails;
  paymentMandateDocumentId?: string;
}) => {
  const mandateYaml = input.paymentMandateDocumentId
    ? `    paymentMandateDocumentId: "${input.paymentMandateDocumentId}"
`
    : '';

  const yaml = `name: Delivery for Simple Card Capture
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  channelBindings:
    payeeChannel:
      accountId: ${input.merchantAccountId}
    cardProcessorChannel:
      accountId: processor-account
  document:
    type: PayNote/Card Transaction PayNote
    name: Simple Card Capture
    LLM_SUMMARY_DISABLED: true
    currency: USD
    amount:
      total: ${input.amountMinor}
${mandateYaml}    payNoteInitialStateDescription:
      summary: Simple low-value card capture scenario for integration tests.
      details: |
        The document uses the pre-authorized card hold and emits a capture
        request once delivery or approval completes.
      initialMessage: A small card-based PayNote offer is ready for you.
    cardTransactionDetails:
      retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
      systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
      transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
      authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
    contracts:
      payerChannel:
        type: MyOS/MyOS Timeline Channel
      payeeChannel:
        type: MyOS/MyOS Timeline Channel
      cardProcessorChannel:
        type: MyOS/MyOS Timeline Channel
      guarantorChannel:
        type: MyOS/MyOS Timeline Channel
cardTransactionDetails:
  retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
  systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
  transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
  authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
contracts:
  payNoteSender:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.merchantAccountId}
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
`;

  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

export const buildPendingInstallPayNote = (input: {
  customerAccountId: string;
  merchantAccountId: string;
  amountMinor: number;
  cardTransactionDetails: TestCardTransactionDetails;
}) => {
  const yaml = `type: PayNote/Card Transaction PayNote
name: Pending Installation Capture
LLM_SUMMARY_DISABLED: true
currency: USD
amount:
  total: ${input.amountMinor}
state:
  approved: false
payNoteInitialStateDescription:
  summary: Requires one customer approval before capture.
  details: |
    This fixture exposes a single pending customer action. After approval the
    document requests capture of the already-authorized card hold.
  initialMessage: Confirm the installation to finish this small PayNote flow.
cardTransactionDetails:
  retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
  systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
  transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
  authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
contracts:
  payerChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.customerAccountId}
  payeeChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.merchantAccountId}
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
  guarantorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
  initLifecycleChannel:
    type: Core/Lifecycle Event Channel
    event:
      type: Core/Document Processing Initiated
  eventsChannel:
    type: Core/Triggered Event Channel
  requestInstallConfirmation:
    type: Conversation/Sequential Workflow
    channel: initLifecycleChannel
    steps:
      - type: Conversation/Trigger Event
        event:
          type: Conversation/Customer Action Requested
          requestId: install-confirmation
          title: Confirm installation
          message: Confirm the installation to capture the authorized payment.
          actions:
            - label: Installation confirmed
              variant: primary
  onInstallConfirmed:
    type: Conversation/Sequential Workflow
    channel: eventsChannel
    event:
      type: Conversation/Customer Action Responded
    steps:
      - name: Decide Install Confirmation
        type: Conversation/JavaScript Code
        code: |
          const inResponseTo = String(event?.inResponseTo?.requestId ?? '').trim();
          const actionLabel = String(event?.actionLabel ?? '').trim();
          if (
            inResponseTo !== 'install-confirmation' ||
            actionLabel !== 'Installation confirmed'
          ) {
            return { changeset: [], followUpEvents: [] };
          }

          return {
            changeset: [
              { op: 'replace', path: '/state/approved', val: true }
            ],
            followUpEvents: [
              {
                type: 'PayNote/Capture Funds Requested',
                requestId: 'install-capture',
                amount: ${input.amountMinor}
              }
            ]
          };
      - name: Apply Install Approval
        type: Conversation/Update Document
        changeset: "\${steps['Decide Install Confirmation'].changeset}"
      - name: Emit Install Follow-up Events
        type: Conversation/JavaScript Code
        code: |
          return { events: steps['Decide Install Confirmation'].followUpEvents || [] };
`;

  return blue.nodeToJson(blue.yamlToNode(yaml)) as Record<string, unknown>;
};

export const buildPendingInstallDeliveryDocument = (input: {
  customerAccountId: string;
  merchantAccountId: string;
  amountMinor: number;
  cardTransactionDetails: TestCardTransactionDetails;
}) => {
  const yaml = `name: Delivery for Pending Installation Capture
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  channelBindings:
    payeeChannel:
      accountId: ${input.merchantAccountId}
    cardProcessorChannel:
      accountId: processor-account
  document:
    type: PayNote/Card Transaction PayNote
    name: Pending Installation Capture
    LLM_SUMMARY_DISABLED: true
    currency: USD
    amount:
      total: ${input.amountMinor}
    state:
      approved: false
    payNoteInitialStateDescription:
      summary: Requires one customer approval before capture.
      details: |
        This fixture exposes a single pending customer action. After approval the
        document requests capture of the already-authorized card hold.
      initialMessage: Confirm the installation to finish this small PayNote flow.
    cardTransactionDetails:
      retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
      systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
      transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
      authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
    contracts:
      payerChannel:
        type: MyOS/MyOS Timeline Channel
      payeeChannel:
        type: MyOS/MyOS Timeline Channel
      cardProcessorChannel:
        type: MyOS/MyOS Timeline Channel
      guarantorChannel:
        type: MyOS/MyOS Timeline Channel
      initLifecycleChannel:
        type: Core/Lifecycle Event Channel
        event:
          type: Core/Document Processing Initiated
      eventsChannel:
        type: Core/Triggered Event Channel
      requestInstallConfirmation:
        type: Conversation/Sequential Workflow
        channel: initLifecycleChannel
        steps:
          - type: Conversation/Trigger Event
            event:
              type: Conversation/Customer Action Requested
              requestId: install-confirmation
              title: Confirm installation
              message: Confirm the installation to capture the authorized payment.
              actions:
                - label: Installation confirmed
                  variant: primary
      onInstallConfirmed:
        type: Conversation/Sequential Workflow
        channel: eventsChannel
        event:
          type: Conversation/Customer Action Responded
        steps:
          - name: Decide Install Confirmation
            type: Conversation/JavaScript Code
            code: |
              const inResponseTo = String(event?.inResponseTo?.requestId ?? '').trim();
              const actionLabel = String(event?.actionLabel ?? '').trim();
              if (
                inResponseTo !== 'install-confirmation' ||
                actionLabel !== 'Installation confirmed'
              ) {
                return { changeset: [], followUpEvents: [] };
              }

              return {
                changeset: [
                  { op: 'replace', path: '/state/approved', val: true }
                ],
                followUpEvents: [
                  {
                    type: 'PayNote/Capture Funds Requested',
                    requestId: 'install-capture',
                    amount: ${input.amountMinor}
                  }
                ]
              };
          - name: Apply Install Approval
            type: Conversation/Update Document
            changeset: "\${steps['Decide Install Confirmation'].changeset}"
          - name: Emit Install Follow-up Events
            type: Conversation/JavaScript Code
            code: |
              return { events: steps['Decide Install Confirmation'].followUpEvents || [] };
cardTransactionDetails:
  retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
  systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
  transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
  authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
contracts:
  payNoteSender:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.merchantAccountId}
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
`;

  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

export const buildScaledMilestonesPayNote = (input: {
  customerAccountId: string;
  merchantAccountId: string;
  cardTransactionDetails: TestCardTransactionDetails;
  completedMilestones?: number;
}) => {
  const completedMilestones = Math.max(0, input.completedMilestones ?? 0);
  const [m1, m2, m3, m4] = [1, 2, 3, 4].map(
    milestoneNumber => completedMilestones >= milestoneNumber
  );
  const totalAmountMinor = FAST_AMOUNTS.scaledMilestoneCapturesMinor.reduce(
    (sum, amountMinor) => sum + amountMinor,
    0
  );

  const yaml = `type: PayNote/Card Transaction PayNote
name: Demo Milestones
LLM_SUMMARY_DISABLED: true
currency: USD
amount:
  total: ${totalAmountMinor}
milestones:
  m1: ${m1}
  m2: ${m2}
  m3: ${m3}
  m4: ${m4}
payNoteInitialStateDescription:
  summary: Uses the existing card hold and releases milestone captures after matching customer approvals.
  details: |
    This scaled fixture mirrors the milestone serial flow used in the coverage package.
    Each customer approval unlocks exactly one partial capture and the next pending action.
  initialMessage: Confirm completed milestones to release contractor payouts.
cardTransactionDetails:
  retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
  systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
  transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
  authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
contracts:
  payerChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.customerAccountId}
  payeeChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.merchantAccountId}
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
  guarantorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
`;

  return blue.nodeToJson(blue.yamlToNode(yaml)) as Record<string, unknown>;
};

export const buildScaledMilestonesDeliveryDocument = (input: {
  merchantAccountId: string;
  cardTransactionDetails: TestCardTransactionDetails;
}) => {
  const totalAmountMinor = FAST_AMOUNTS.scaledMilestoneCapturesMinor.reduce(
    (sum, amountMinor) => sum + amountMinor,
    0
  );

  const yaml = `name: Delivery for Demo Milestones
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  channelBindings:
    payeeChannel:
      accountId: ${input.merchantAccountId}
    cardProcessorChannel:
      accountId: processor-account
  document:
    type: PayNote/Card Transaction PayNote
    name: Demo Milestones
    LLM_SUMMARY_DISABLED: true
    currency: USD
    amount:
      total: ${totalAmountMinor}
    milestones:
      m1: false
      m2: false
      m3: false
      m4: false
    payNoteInitialStateDescription:
      summary: Uses the existing card hold and releases milestone captures after matching customer approvals.
      details: |
        Each customer approval unlocks exactly one partial capture and the next pending action.
      initialMessage: Confirm completed milestones to release contractor payouts.
    cardTransactionDetails:
      retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
      systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
      transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
      authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
    contracts:
      payerChannel:
        type: MyOS/MyOS Timeline Channel
      payeeChannel:
        type: MyOS/MyOS Timeline Channel
      cardProcessorChannel:
        type: MyOS/MyOS Timeline Channel
      guarantorChannel:
        type: MyOS/MyOS Timeline Channel
cardTransactionDetails:
  retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
  systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
  transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
  authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
contracts:
  payNoteSender:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.merchantAccountId}
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
`;

  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

export const buildSubscriptionPayNote = (input: {
  customerAccountId: string;
  merchantAccountId: string;
  merchantId: string;
  cardTransactionDetails: TestCardTransactionDetails;
  paymentMandateDocumentId?: string;
  paymentMandateStatus?:
    | 'not_requested'
    | 'requested'
    | 'bootstrapping'
    | 'active';
  completedCycles?: number;
  successfulPaymentsMinor?: number;
}) => {
  const paymentMandateStatus = input.paymentMandateStatus ?? 'not_requested';
  const completedCycles = input.completedCycles ?? 0;
  const successfulPaymentsMinor =
    input.successfulPaymentsMinor ??
    completedCycles * FAST_AMOUNTS.subscriptionMonthlyMinor;

  const paymentMandateDocumentIdYaml = input.paymentMandateDocumentId
    ? `  paymentMandateDocumentId: "${input.paymentMandateDocumentId}"`
    : '  paymentMandateDocumentId:';

  const yaml = `type: PayNote/Card Transaction PayNote
name: Exclusive Spotify Subscription Offer
LLM_SUMMARY_DISABLED: true
currency: USD
amount:
  total: ${FAST_AMOUNTS.subscriptionMonthlyMinor}
subscription:
  monthlyAmountMinor: ${FAST_AMOUNTS.subscriptionMonthlyMinor}
  totalCycles: 12
  completedCycles: ${completedCycles}
  successfulPaymentsMinor: ${successfulPaymentsMinor}
  paymentMandateStatus: ${paymentMandateStatus}
${paymentMandateDocumentIdYaml}
  paymentMandateRequest:
    requestId: subscription-payment-mandate
    summary: Approve automated payments for 12-month subscription. You can cancel any time.
    customerMessage: 12-month subscription - 12 USD payment once a month.
    amountLimit: 14400
    expiresAt: 2027-12-31T23:59:59Z
    merchantId: ${input.merchantId}
payNoteInitialStateDescription:
  summary: Root card transaction captures cycle 1 and bootstrap authorizes the recurring mandate.
  details: |
    This scaled fixture mirrors the subscription bootstrap and one follow-up cycle flow.
  initialMessage: Thank you for signing up. Get 1 extra free month if you subscribe now.
cardTransactionDetails:
  retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
  systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
  transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
  authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
contracts:
  payerChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.customerAccountId}
  payeeChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.merchantAccountId}
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
  guarantorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
`;

  return blue.nodeToJson(blue.yamlToNode(yaml)) as Record<string, unknown>;
};

export const buildSubscriptionDeliveryDocument = (input: {
  merchantAccountId: string;
  merchantId: string;
  cardTransactionDetails: TestCardTransactionDetails;
}) => {
  const yaml = `name: Delivery for Exclusive Spotify Subscription Offer
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  channelBindings:
    payeeChannel:
      accountId: ${input.merchantAccountId}
    cardProcessorChannel:
      accountId: processor-account
  document:
    type: PayNote/Card Transaction PayNote
    name: Exclusive Spotify Subscription Offer
    LLM_SUMMARY_DISABLED: true
    currency: USD
    amount:
      total: ${FAST_AMOUNTS.subscriptionMonthlyMinor}
    subscription:
      monthlyAmountMinor: ${FAST_AMOUNTS.subscriptionMonthlyMinor}
      totalCycles: 12
      completedCycles: 0
      successfulPaymentsMinor: 0
      paymentMandateStatus: not_requested
      paymentMandateDocumentId:
      paymentMandateRequest:
        requestId: subscription-payment-mandate
        summary: Approve automated payments for 12-month subscription. You can cancel any time.
        customerMessage: 12-month subscription - 12 USD payment once a month.
        amountLimit: 14400
        expiresAt: 2027-12-31T23:59:59Z
        merchantId: ${input.merchantId}
    payNoteInitialStateDescription:
      summary: Root card transaction captures cycle 1 and bootstrap authorizes the recurring mandate.
      details: |
        This scaled fixture mirrors the subscription bootstrap and one follow-up cycle flow.
      initialMessage: Thank you for signing up. Get 1 extra free month if you subscribe now.
    cardTransactionDetails:
      retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
      systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
      transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
      authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
    contracts:
      payerChannel:
        type: MyOS/MyOS Timeline Channel
      payeeChannel:
        type: MyOS/MyOS Timeline Channel
      cardProcessorChannel:
        type: MyOS/MyOS Timeline Channel
      guarantorChannel:
        type: MyOS/MyOS Timeline Channel
cardTransactionDetails:
  retrievalReferenceNumber: "${input.cardTransactionDetails.retrievalReferenceNumber}"
  systemTraceAuditNumber: "${input.cardTransactionDetails.systemTraceAuditNumber}"
  transmissionDateTime: "${input.cardTransactionDetails.transmissionDateTime}"
  authorizationCode: "${input.cardTransactionDetails.authorizationCode}"
contracts:
  payNoteSender:
    type: MyOS/MyOS Timeline Channel
    accountId: ${input.merchantAccountId}
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
`;

  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

export const buildSubscriptionMandateDocument = (input: {
  customerUserId: string;
  merchantId: string;
  approvedChargeAttemptId?: string;
  amountLimitMinor?: number;
  allowLinkedPayNote?: boolean;
}) => {
  const chargeAttemptsYaml = input.approvedChargeAttemptId
    ? `chargeAttempts:
  ${input.approvedChargeAttemptId}:
    authorizationStatus: approved
    settled: true
`
    : '';

  const yaml = `type: PayNote/Payment Mandate
name: Subscription Payment Mandate
LLM_SUMMARY_DISABLED: true
granterType: customer
granterId: ${input.customerUserId}
granteeType: merchantId
granteeId: ${input.merchantId}
amountLimit: ${input.amountLimitMinor ?? 14_400}
currency: USD
sourceAccount: root
allowLinkedPayNote: ${input.allowLinkedPayNote ?? false}
allowedPaymentCounterparties:
  - counterpartyType: merchantId
    counterpartyId: ${input.merchantId}
expiresAt: 2027-12-31T23:59:59Z
${chargeAttemptsYaml}`;

  return blue.nodeToJson(blue.yamlToNode(yaml)) as Record<string, unknown>;
};

export const buildTransferPayNote = (input: {
  payerAccountNumber: string;
  payeeAccountNumber: string;
  amountMinor: number;
}) => ({
  type: {
    blueId: paynoteBlueIds['PayNote/PayNote'],
  },
  name: 'Simple Transfer Reserve Capture',
  LLM_SUMMARY_DISABLED: true,
  currency: 'USD',
  amount: {
    total: {
      value: input.amountMinor,
    },
  },
  payerAccountNumber: {
    value: input.payerAccountNumber,
  },
  payeeAccountNumber: {
    value: input.payeeAccountNumber,
  },
  payNoteInitialStateDescription: {
    summary: 'Simple low-value transfer reserve and capture scenario.',
    details:
      'The document first requests reserve on the payer account and later requests capture for the same transfer amount.',
    initialMessage: 'Approve a small transfer-based PayNote flow.',
  },
});

export const emittedReserveFundsRequested = (
  amountMinor: number,
  requestId: string
) => ({
  type: {
    name: 'PayNote/Reserve Funds Requested',
    blueId: paynoteBlueIds['PayNote/Reserve Funds Requested'],
  },
  requestId,
  amount: { value: amountMinor },
});

export const emittedCaptureFundsRequested = (
  amountMinor: number,
  requestId: string
) => ({
  type: {
    name: 'PayNote/Capture Funds Requested',
    blueId: paynoteBlueIds['PayNote/Capture Funds Requested'],
  },
  requestId,
  amount: { value: amountMinor },
});

export const emittedCustomerActionRequested = (input: {
  requestId: string;
  title: string;
  message: string;
  actions: Array<{
    label: string;
    description?: string;
    variant?: 'primary' | 'secondary' | 'reject';
  }>;
}) => ({
  type: {
    name: 'Conversation/Customer Action Requested',
    blueId: conversationBlueIds['Conversation/Customer Action Requested'],
  },
  requestId: input.requestId,
  title: input.title,
  message: input.message,
  actions: input.actions,
});

export const emittedReserveAndCaptureImmediatelyRequested = (
  amountMinor: number,
  requestId: string
) => ({
  type: {
    name: 'PayNote/Reserve Funds and Capture Immediately Requested',
    blueId:
      paynoteBlueIds['PayNote/Reserve Funds and Capture Immediately Requested'],
  },
  requestId,
  amount: { value: amountMinor },
});
