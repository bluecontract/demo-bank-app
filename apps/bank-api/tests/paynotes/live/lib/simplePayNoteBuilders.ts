import { Blue } from '@blue-labs/language';
import { createDefaultMergingProcessor } from '@blue-labs/document-processor';
import { repository } from '@blue-repository/types';
import conversationBlueIds from '@blue-repository/types/packages/conversation/blue-ids';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';

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
