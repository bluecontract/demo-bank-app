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

export const buildSimpleCardTransactionPayNote = (input: {
  customerAccountId: string;
  merchantAccountId: string;
  amountMinor: number;
  paymentMandateDocumentId?: string;
}) => ({
  name: 'Simple Card Capture',
  LLM_SUMMARY_DISABLED: true,
  type: 'PayNote/Card Transaction PayNote',
  currency: 'USD',
  amount: { total: input.amountMinor },
  payNoteInitialStateDescription: {
    summary: 'Simple low-value card capture scenario for integration tests.',
    details:
      'The document uses the pre-authorized card hold and emits a capture request once delivery or approval completes.',
    initialMessage: 'A small card-based PayNote offer is ready for you.',
  },
  contracts: {
    payerChannel: {
      type: 'MyOS/MyOS Timeline Channel',
      accountId: input.customerAccountId,
    },
    payeeChannel: {
      type: 'MyOS/MyOS Timeline Channel',
      accountId: input.merchantAccountId,
    },
    guarantorChannel: {
      type: 'MyOS/MyOS Timeline Channel',
      accountId: input.customerAccountId,
    },
  },
  ...(input.paymentMandateDocumentId
    ? { paymentMandateDocumentId: input.paymentMandateDocumentId }
    : {}),
});

export const buildSimpleTransferPayNote = (input: {
  payerAccountNumber: string;
  payeeAccountNumber: string;
  amountMinor: number;
}) => ({
  name: 'Simple Transfer Reserve Capture',
  LLM_SUMMARY_DISABLED: true,
  type: 'PayNote/PayNote',
  currency: 'USD',
  payerAccountNumber: { value: input.payerAccountNumber },
  payeeAccountNumber: { value: input.payeeAccountNumber },
  amount: { total: input.amountMinor },
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
  type: 'PayNote/Reserve Funds Requested',
  requestId,
  amount: amountMinor,
});

export const emittedCaptureFundsRequested = (
  amountMinor: number,
  requestId: string
) => ({
  type: 'PayNote/Capture Funds Requested',
  requestId,
  amount: amountMinor,
});

export const emittedLinkedChargeAndCaptureRequested = (input: {
  requestId: string;
  amountMinor: number;
  paymentMandateDocumentId: string;
  paynote?: Record<string, unknown>;
}) => ({
  type: 'PayNote/Linked Card Charge and Capture Immediately Requested',
  requestId: input.requestId,
  amount: input.amountMinor,
  paymentMandateDocumentId: input.paymentMandateDocumentId,
  ...(input.paynote ? { paynote: input.paynote } : {}),
});
