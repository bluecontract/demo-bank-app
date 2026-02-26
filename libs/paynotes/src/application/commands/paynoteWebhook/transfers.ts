import {
  MerchantToCustomerPayNoteSchema,
  PaymentMandateSpendAuthorizationRespondedSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import type {
  BankingAccount,
  PayNoteDeliveryRecord,
  PayNoteRecord,
} from '../../ports';
import type { LogEntry } from '../../ports';
import type {
  HandleWebhookEventDependencies,
  HandleWebhookEventResult,
  WebhookEmittedEvent,
  WebhookEventObject,
} from './types';
import {
  CAPTURE_FUNDS_EVENT_NAME,
  CAPTURE_IMMEDIATELY_EVENT_NAME,
  CAPTURE_LOCK_REQUESTED_EVENT_NAME,
  CAPTURE_UNLOCK_REQUESTED_EVENT_NAME,
  MANDATE_SPEND_AUTHORIZATION_RESPONDED_EVENT_NAME,
  RESERVE_FUNDS_EVENT_NAME,
  resolveEmittedEventType,
  resolveTransferPaymentMandateDocumentId,
  resolveTransferRequestId,
} from './events';
import { logAndReturn } from './logging';
import { resolveDeliveryRecord, upsertPayNoteContract } from './records';
import { runGuarantorUpdate } from '../documentOperations';
import type { DispatchedTransferEvent } from './eventDispatcher';
import { blue } from '../../../blue';
import {
  getString,
  toSimpleRecord,
  resolveOperationFailureReason,
  resolveCredentials,
  parseChargeAttemptId,
} from './utils';
import { resolveRuntimeDocument } from '../blueRuntime';
import { resolveWebhookContext } from './payload';

const FUNDS_RESERVED_EVENT_NAME = 'PayNote/Funds Reserved';
const RESERVATION_DECLINED_EVENT_NAME = 'PayNote/Reservation Declined';
const FUNDS_CAPTURED_EVENT_NAME = 'PayNote/Funds Captured';
const CAPTURE_DECLINED_EVENT_NAME = 'PayNote/Capture Declined';
const CAPTURE_FAILED_EVENT_NAME = 'PayNote/Capture Failed';
const MANDATE_AUTHORIZE_OPERATION = 'authorizeSpend';
const MANDATE_SETTLE_OPERATION = 'settleSpend';
const MANDATE_SPEND_AUTHORIZATION_REQUESTED_EVENT_NAME =
  'PayNote/Payment Mandate Spend Authorization Requested';
const MANDATE_SPEND_SETTLED_EVENT_NAME =
  'PayNote/Payment Mandate Spend Settled';

type TransferMandateChargeMode = 'authorize_only' | 'authorize_and_capture';

type TransferMandateAuthorization = {
  chargeAttemptId: string;
  mandateDocumentId: string;
  mandateSessionId: string;
};

type TransferMandateAuthorizationResponse = {
  chargeAttemptId: string;
  status: 'approved' | 'rejected';
  reason?: string;
};

type ParsedTransferPaymentMandate = {
  revokedAt?: string;
  expiresAt?: string;
  sourceAccount?: string;
  granterType?: string;
  chargeAttempts?: Record<string, unknown>;
};

type TransferMandateCounterparty = {
  counterpartyType: 'merchantId' | 'customerId' | 'accountNumber';
  counterpartyId: string;
};

const resolveTransferSourcePayNoteType = (
  document: unknown
): 'merchant-to-customer-paynote' | 'other' => {
  if (!document) {
    return 'other';
  }

  try {
    const node = blue.jsonValueToNode(document);
    if (
      blue.isTypeOf(node, MerchantToCustomerPayNoteSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return 'merchant-to-customer-paynote';
    }
  } catch {
    return 'other';
  }

  return 'other';
};

const isDeliveryVoucherTransferContext = (
  context: TransferContext
): boolean => {
  const sourceType = resolveTransferSourcePayNoteType(
    context.eventObject?.document ?? context.updatedRecord.document
  );
  if (sourceType !== 'merchant-to-customer-paynote') {
    return false;
  }

  const hasDeliveryOrChainContext = Boolean(
    context.deliveryRecord?.deliveryId ??
      context.updatedRecord.deliveryId ??
      context.deliveryRecord?.cardTransactionDetails ??
      context.updatedRecord.transactionId ??
      context.updatedRecord.holdId
  );
  const hasMerchantAndCustomerContext = Boolean(
    getString(
      context.deliveryRecord?.merchantId ?? context.updatedRecord.merchantId
    ) &&
      getString(context.deliveryRecord?.userId ?? context.updatedRecord.userId)
  );

  return hasDeliveryOrChainContext && hasMerchantAndCustomerContext;
};

const parseTransferPaymentMandate = (
  value: unknown
): ParsedTransferPaymentMandate | null => {
  const parseChargeAttempts = (
    candidate: unknown
  ): Record<string, unknown> | undefined => {
    const attempts = toSimpleRecord(candidate);
    if (!attempts) {
      return undefined;
    }

    const normalized = Object.entries(attempts).reduce<Record<string, unknown>>(
      (acc, [chargeAttemptId, attempt]) => {
        const attemptRecord = toSimpleRecord(attempt);
        if (!attemptRecord) {
          return acc;
        }

        acc[chargeAttemptId] = { ...attemptRecord };
        return acc;
      },
      {}
    );

    return Object.keys(normalized).length > 0 ? normalized : {};
  };

  const runtimeDocument = resolveRuntimeDocument(value);
  if (!runtimeDocument) {
    return null;
  }

  const output = runtimeDocument.record;
  return {
    revokedAt: getString(output.revokedAt),
    expiresAt: getString(output.expiresAt),
    sourceAccount: getString(output.sourceAccount),
    granterType: getString(output.granterType),
    chargeAttempts: parseChargeAttempts(output.chargeAttempts),
  };
};

const parseIsoTimestampMs = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const resolveTransferMandateCounterparty = (input: {
  context: TransferContext;
  payerAccountNumber: string;
  payeeAccountNumber?: string;
  mandate: ParsedTransferPaymentMandate;
}): TransferMandateCounterparty | null => {
  const { context, payerAccountNumber, payeeAccountNumber, mandate } = input;
  const merchantId = getString(
    context.deliveryRecord?.merchantId ?? context.updatedRecord.merchantId
  );
  const customerId = getString(
    context.deliveryRecord?.userId ?? context.updatedRecord.userId
  );
  const rootCustomerAccountNumber = getString(
    context.deliveryRecord?.accountNumber ?? context.updatedRecord.accountNumber
  );

  if (mandate.granterType === 'merchant') {
    if (customerId) {
      return { counterpartyType: 'customerId', counterpartyId: customerId };
    }
    if (payeeAccountNumber) {
      return {
        counterpartyType: 'accountNumber',
        counterpartyId: payeeAccountNumber,
      };
    }
    return null;
  }

  if (mandate.granterType === 'customer') {
    if (merchantId) {
      return { counterpartyType: 'merchantId', counterpartyId: merchantId };
    }
    if (payeeAccountNumber) {
      return {
        counterpartyType: 'accountNumber',
        counterpartyId: payeeAccountNumber,
      };
    }
    return null;
  }

  if (
    rootCustomerAccountNumber &&
    payerAccountNumber === rootCustomerAccountNumber
  ) {
    if (merchantId) {
      return { counterpartyType: 'merchantId', counterpartyId: merchantId };
    }
  } else if (customerId) {
    return { counterpartyType: 'customerId', counterpartyId: customerId };
  }

  if (payeeAccountNumber) {
    return {
      counterpartyType: 'accountNumber',
      counterpartyId: payeeAccountNumber,
    };
  }

  return null;
};

const resolveMerchantCounterpartyAccountNumber = async (
  context: TransferContext
): Promise<string | undefined> => {
  const merchantId = getString(
    context.deliveryRecord?.merchantId ?? context.updatedRecord.merchantId
  );
  if (!merchantId) {
    return undefined;
  }

  const resolver =
    context.deps.bankingFacade.getActiveCreditLineAccountByMerchantId;
  if (typeof resolver !== 'function') {
    return undefined;
  }

  const account = await resolver(merchantId);
  return account ? getString(account.accountNumber) : undefined;
};

const buildTransferMandateChargeAttemptId = (input: {
  payNoteDocumentId: string;
  eventId: string;
  eventIndex: number;
}) =>
  [input.payNoteDocumentId, input.eventId, String(input.eventIndex)].join(':');

const parseTransferMandateAuthorizationResponse = (
  event: WebhookEmittedEvent
): TransferMandateAuthorizationResponse | null => {
  try {
    const node = blue.jsonValueToNode(event);
    if (
      !blue.isTypeOf(node, PaymentMandateSpendAuthorizationRespondedSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return null;
    }

    const output = blue.nodeToSchemaOutput(
      node,
      PaymentMandateSpendAuthorizationRespondedSchema
    ) as {
      chargeAttemptId?: unknown;
      status?: unknown;
      reason?: unknown;
    };
    const chargeAttemptId = getString(output.chargeAttemptId);
    const status = getString(output.status);
    if (!chargeAttemptId || (status !== 'approved' && status !== 'rejected')) {
      return null;
    }

    return {
      chargeAttemptId,
      status,
      reason: getString(output.reason),
    };
  } catch {
    return null;
  }
};

const buildTransferMandateAttemptProcessingKey = (chargeAttemptId: string) =>
  `paynote-transfer-mandate-attempt-processed:${chargeAttemptId}`;

const resolveStoredTransferMandateAuthorization = (input: {
  updatedRecord: PayNoteRecord;
  holdId: string;
  requestedMandateDocumentId?: string;
}):
  | null
  | { ok: true; authorization: TransferMandateAuthorization }
  | { ok: false; reason: string } => {
  const holdAttempt = toSimpleRecord(
    input.updatedRecord.transferMandateAttemptsByHoldId?.[input.holdId]
  );
  if (!holdAttempt) {
    return null;
  }

  const mandateDocumentId = getString(holdAttempt.mandateDocumentId);
  const mandateSessionId = getString(holdAttempt.mandateSessionId);
  const chargeAttemptId = getString(holdAttempt.chargeAttemptId);
  if (!mandateDocumentId || !mandateSessionId || !chargeAttemptId) {
    return {
      ok: false,
      reason:
        'Stored payment mandate authorization mapping is invalid for this hold.',
    };
  }

  if (
    input.requestedMandateDocumentId &&
    input.requestedMandateDocumentId !== mandateDocumentId
  ) {
    return {
      ok: false,
      reason:
        'Payment mandate document id does not match the reserved hold authorization.',
    };
  }

  return {
    ok: true,
    authorization: {
      chargeAttemptId,
      mandateDocumentId,
      mandateSessionId,
    },
  };
};

const upsertTransferMandateHoldAttempt = (input: {
  updatedRecord: PayNoteRecord;
  holdId: string;
  authorization: TransferMandateAuthorization;
  updatedAt: string;
}): boolean => {
  const nextEntry = {
    mandateDocumentId: input.authorization.mandateDocumentId,
    mandateSessionId: input.authorization.mandateSessionId,
    chargeAttemptId: input.authorization.chargeAttemptId,
    updatedAt: input.updatedAt,
  };
  const currentEntries =
    input.updatedRecord.transferMandateAttemptsByHoldId ?? {};
  const currentEntry = currentEntries[input.holdId];
  const isUnchanged =
    currentEntry?.mandateDocumentId === nextEntry.mandateDocumentId &&
    currentEntry?.mandateSessionId === nextEntry.mandateSessionId &&
    currentEntry?.chargeAttemptId === nextEntry.chargeAttemptId;

  if (isUnchanged) {
    return false;
  }

  input.updatedRecord.transferMandateAttemptsByHoldId = {
    ...currentEntries,
    [input.holdId]: nextEntry,
  };
  return true;
};

const authorizeTransferViaMandateIfRequired = async (input: {
  context: TransferContext;
  event: WebhookEmittedEvent;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  eventIndex: number;
  amountMinor: number;
  payerAccountNumber: string;
  payeeAccountNumber?: string;
}): Promise<
  | { ok: true; authorization?: TransferMandateAuthorization }
  | { ok: false; reason: string; pending?: boolean }
> => {
  const {
    context,
    event,
    eventType,
    eventIndex,
    amountMinor,
    payerAccountNumber,
    payeeAccountNumber,
  } = input;

  if (!isDeliveryVoucherTransferContext(context)) {
    return { ok: true };
  }

  const mandateDocumentId = resolveTransferPaymentMandateDocumentId(event);
  if (!mandateDocumentId) {
    return {
      ok: false,
      reason: 'Missing payment mandate document id.',
    };
  }

  const mandateContract =
    await context.deps.contractRepository.getContractByDocumentId(
      mandateDocumentId
    );
  const mandateSessionId = getString(mandateContract?.sessionId);
  if (!mandateSessionId) {
    return {
      ok: false,
      reason: 'Unable to resolve payment mandate session id.',
    };
  }

  const mandateDocumentResult = await context.deps.myOsClient.fetchDocument(
    mandateSessionId
  );
  if (
    mandateDocumentResult.kind !== 'success' ||
    !mandateDocumentResult.document.document
  ) {
    return {
      ok: false,
      reason: 'Unable to load payment mandate document.',
    };
  }

  const mandate = parseTransferPaymentMandate(
    mandateDocumentResult.document.document
  );
  if (!mandate) {
    return {
      ok: false,
      reason: 'Invalid payment mandate document payload.',
    };
  }

  if (mandate.revokedAt) {
    return {
      ok: false,
      reason: 'Payment mandate is revoked.',
    };
  }

  const expiresAtMs = parseIsoTimestampMs(mandate.expiresAt);
  if (mandate.expiresAt && expiresAtMs === undefined) {
    return {
      ok: false,
      reason: 'Payment mandate has invalid expiresAt timestamp.',
    };
  }
  if (
    expiresAtMs !== undefined &&
    expiresAtMs <= context.deps.clock.now().getTime()
  ) {
    return {
      ok: false,
      reason: 'Payment mandate is expired.',
    };
  }

  if (mandate.sourceAccount && mandate.sourceAccount !== 'root') {
    return {
      ok: false,
      reason:
        'Payment mandate sourceAccount is not supported for transfer requests.',
    };
  }

  const counterparty = resolveTransferMandateCounterparty({
    context,
    payerAccountNumber,
    payeeAccountNumber,
    mandate,
  });
  if (!counterparty) {
    return {
      ok: false,
      reason:
        'Unable to resolve mandate authorization counterparty for transfer request.',
    };
  }

  const credentials = await resolveCredentials(context.deps, context.logs, {
    eventId: context.eventId,
    payNoteDocumentId: context.payNoteDocumentId,
    sessionId: context.sessionId,
    errorMessage:
      'Failed to resolve MyOS credentials for PayNote guarantor update',
  });
  if (!credentials) {
    return {
      ok: false,
      reason: 'Missing MyOS credentials.',
    };
  }

  const chargeAttemptId = buildTransferMandateChargeAttemptId({
    payNoteDocumentId: context.payNoteDocumentId,
    eventId: context.eventId,
    eventIndex,
  });
  const mode: TransferMandateChargeMode =
    eventType === RESERVE_FUNDS_EVENT_NAME
      ? 'authorize_only'
      : 'authorize_and_capture';

  const authorizeResponse = await context.deps.myOsClient.runDocumentOperation({
    credentials,
    sessionId: mandateSessionId,
    operation: MANDATE_AUTHORIZE_OPERATION,
    payload: {
      type: MANDATE_SPEND_AUTHORIZATION_REQUESTED_EVENT_NAME,
      chargeAttemptId,
      requestingDocumentId: context.payNoteDocumentId,
      requestingSessionId: context.sessionId,
      amountMinor,
      currency: 'USD',
      requestedAt: context.deps.clock.now().toISOString(),
      counterpartyType: counterparty.counterpartyType,
      counterpartyId: counterparty.counterpartyId,
      chargeMode: mode,
    },
  });
  if (!authorizeResponse.ok) {
    return {
      ok: false,
      reason: resolveOperationFailureReason({
        status: authorizeResponse.status,
        body: authorizeResponse.body,
        fallbackPrefix: 'Payment mandate authorizeSpend failed',
      }),
    };
  }

  const mandateAfterAuthorize = await context.deps.myOsClient.fetchDocument(
    mandateSessionId
  );
  if (
    mandateAfterAuthorize.kind !== 'success' ||
    !mandateAfterAuthorize.document.document
  ) {
    return {
      ok: false,
      reason:
        'Unable to resolve payment mandate authorization result after authorizeSpend.',
    };
  }
  const refreshedMandate = parseTransferPaymentMandate(
    mandateAfterAuthorize.document.document
  );
  const attempt = toSimpleRecord(
    refreshedMandate?.chargeAttempts?.[chargeAttemptId]
  );
  const authorizationStatus = getString(attempt?.authorizationStatus);
  if (authorizationStatus === 'rejected') {
    return {
      ok: false,
      reason:
        getString(attempt?.authorizationReason) ??
        'Payment mandate rejected transfer authorization.',
    };
  }
  if (authorizationStatus !== 'approved') {
    return {
      ok: false,
      pending: true,
      reason: 'Payment mandate authorization is pending confirmation.',
    };
  }

  return {
    ok: true,
    authorization: {
      chargeAttemptId,
      mandateDocumentId,
      mandateSessionId,
    },
  };
};

const reserveTransferMandateAttemptProcessing = async (input: {
  context: TransferContext;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  eventIndex: number;
  requestId?: string;
  authorization: TransferMandateAuthorization;
}): Promise<boolean> => {
  const key = buildTransferMandateAttemptProcessingKey(
    input.authorization.chargeAttemptId
  );
  const firstProcess =
    await input.context.deps.payNoteRepository.markEventProcessed(key);
  if (!firstProcess) {
    input.context.logs.push({
      level: 'info',
      message: 'Skipped duplicate transfer mandate authorization response',
      context: {
        eventId: input.context.eventId,
        payNoteDocumentId: input.context.payNoteDocumentId,
        sessionId: input.context.sessionId,
        eventType: input.eventType,
        eventIndex: input.eventIndex,
        requestId: input.requestId ?? null,
        chargeAttemptId: input.authorization.chargeAttemptId,
        dedupeKey: key,
      },
    });
  }
  return firstProcess;
};

const runTransferMandateSettlement = async (input: {
  context: TransferContext;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  eventIndex: number;
  requestId?: string;
  authorization: TransferMandateAuthorization;
  amountMinor: number;
  status: 'succeeded' | 'failed';
  reason?: string;
  holdId?: string;
  transactionId?: string;
}): Promise<void> => {
  const {
    context,
    eventType,
    eventIndex,
    requestId,
    authorization,
    amountMinor,
    status,
    reason,
    holdId,
    transactionId,
  } = input;

  const credentials = await resolveCredentials(context.deps, context.logs, {
    eventId: context.eventId,
    payNoteDocumentId: context.payNoteDocumentId,
    sessionId: context.sessionId,
    errorMessage:
      'Failed to resolve MyOS credentials for PayNote guarantor update',
  });
  if (!credentials) {
    return;
  }

  const isReserveEvent = eventType === RESERVE_FUNDS_EVENT_NAME;
  const reservedDeltaMinor =
    status === 'succeeded' ? (isReserveEvent ? 0 : -amountMinor) : -amountMinor;
  const capturedDeltaMinor =
    status === 'succeeded' && !isReserveEvent ? amountMinor : 0;

  const settlementResponse = await context.deps.myOsClient.runDocumentOperation(
    {
      credentials,
      sessionId: authorization.mandateSessionId,
      operation: MANDATE_SETTLE_OPERATION,
      payload: {
        type: MANDATE_SPEND_SETTLED_EVENT_NAME,
        chargeAttemptId: authorization.chargeAttemptId,
        status,
        settledAt: context.deps.clock.now().toISOString(),
        reservedDeltaMinor,
        capturedDeltaMinor,
        ...(reason ? { reason } : {}),
        ...(holdId ? { holdId } : {}),
        ...(transactionId ? { transactionId } : {}),
      },
    }
  );
  if (!settlementResponse.ok) {
    context.logs.push({
      level: 'warn',
      message: 'Payment mandate settleSpend request failed for transfer flow',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        sessionId: context.sessionId,
        eventType,
        eventIndex,
        requestId: requestId ?? null,
        mandateDocumentId: authorization.mandateDocumentId,
        chargeAttemptId: authorization.chargeAttemptId,
        reason: resolveOperationFailureReason({
          status: settlementResponse.status,
          body: settlementResponse.body,
          fallbackPrefix: 'Payment mandate settleSpend failed',
        }),
      },
    });
  }
};

const resolvePayerAccount = async (input: {
  payerAccountNumber: string;
  eventId: string;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<
  | { account: BankingAccount & { ownerUserId: string } }
  | { result: HandleWebhookEventResult }
> => {
  const { payerAccountNumber, eventId, deps, logs } = input;

  const account = await deps.bankingFacade.getAccountByNumber(
    payerAccountNumber
  );

  if (!account) {
    const note = logAndReturn(
      logs,
      'error',
      'Unable to resolve payer account ID from number for PayNote transfer',
      {
        eventId,
        payerAccountNumber,
      }
    );
    return { result: { note, logs } };
  }

  if (!account.ownerUserId) {
    const note = logAndReturn(
      logs,
      'error',
      'Unable to resolve payer account owner for PayNote transfer',
      {
        eventId,
        payerAccountId: account.id,
      }
    );
    return { result: { note, logs } };
  }

  const accountWithOwner = account as BankingAccount & {
    ownerUserId: string;
  };

  return { account: accountWithOwner };
};

const syncPayNoteRecordAccount = async (input: {
  updatedRecord: PayNoteRecord;
  account: BankingAccount & { ownerUserId: string };
  deps: HandleWebhookEventDependencies;
}): Promise<void> => {
  const { updatedRecord, account, deps } = input;

  if (updatedRecord.userId && updatedRecord.accountNumber) {
    return;
  }

  updatedRecord.userId = account.ownerUserId;
  updatedRecord.accountNumber = account.accountNumber;
  const updatedAt = deps.clock.now().toISOString();
  updatedRecord.updatedAt = updatedAt;
  await deps.payNoteRepository.savePayNote({
    ...updatedRecord,
    updatedAt,
  });
};

type TransferContext = {
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  eventObject?: WebhookEventObject;
  emittedEvents?: WebhookEmittedEvent[];
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
  transferDescription: string;
  updatedRecord: PayNoteRecord;
  deliveryRecord: PayNoteDeliveryRecord | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
};

type TransferEventWithMetadata = DispatchedTransferEvent;

const resolveRequestId = (event: WebhookEmittedEvent): string | undefined =>
  resolveTransferRequestId(event);

const isTransferEventType = (
  eventType: string | undefined
): eventType is
  | typeof RESERVE_FUNDS_EVENT_NAME
  | typeof CAPTURE_FUNDS_EVENT_NAME
  | typeof CAPTURE_IMMEDIATELY_EVENT_NAME =>
  eventType === RESERVE_FUNDS_EVENT_NAME ||
  eventType === CAPTURE_FUNDS_EVENT_NAME ||
  eventType === CAPTURE_IMMEDIATELY_EVENT_NAME;

const buildTransferOperationIdempotencyKey = (input: {
  payNoteDocumentId: string;
  eventId: string;
  eventIndex: number;
  operation: 'capture-immediately' | 'reserve-funds' | 'capture-funds';
  requestId?: string;
}): string =>
  [
    'paynote-transfer',
    input.operation,
    input.payNoteDocumentId,
    'event',
    input.eventId,
    String(input.eventIndex),
  ].join(':');

const reserveTransferRequestProcessing = async (input: {
  payNoteDocumentId: string;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  eventId: string;
  eventIndex: number;
  requestId?: string;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const {
    payNoteDocumentId,
    eventType,
    eventId,
    eventIndex,
    requestId,
    deps,
    logs,
  } = input;

  const dedupeEventId = [
    'paynote-transfer-request',
    payNoteDocumentId,
    eventType,
    'event',
    eventId,
    String(eventIndex),
  ].join(':');
  const firstProcessing = await deps.payNoteRepository.markEventProcessed(
    dedupeEventId
  );

  if (!firstProcessing) {
    logs.push({
      level: 'info',
      message: 'Skipped duplicate PayNote transfer request',
      context: {
        eventId,
        payNoteDocumentId,
        eventIndex,
        eventType,
        requestId: requestId ?? null,
        dedupeEventId,
      },
    });
    return false;
  }

  return true;
};

const buildResponseEvent = (input: {
  type: string;
  requestId?: string;
  amountField?: 'amountReserved' | 'amountCaptured';
  amount?: number;
  reason?: string;
}): Record<string, unknown> => {
  const event: Record<string, unknown> = {
    type: input.type,
  };

  if (input.requestId) {
    event.inResponseTo = {
      requestId: input.requestId,
    };
  }

  if (input.amountField && typeof input.amount === 'number') {
    event[input.amountField] = input.amount;
  }

  if (typeof input.reason === 'string' && input.reason.trim().length > 0) {
    event.reason = input.reason;
  }

  return event;
};

const emitGuarantorResponseEvent = async (input: {
  sessionId: string;
  responseEvent: Record<string, unknown>;
  successMessage: string;
  failureMessage: string;
  missingCredentialsMessage: string;
  context: {
    eventId: string;
    payNoteDocumentId: string;
    eventType?: string;
    requestId?: string;
  };
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const credentials = await resolveCredentials(input.deps, input.logs, {
    eventId: input.context.eventId,
    payNoteDocumentId: input.context.payNoteDocumentId,
    sessionId: input.sessionId,
  });

  return runGuarantorUpdate({
    myOsClient: input.deps.myOsClient,
    sessionId: input.sessionId,
    credentials,
    logs: input.logs,
    logContext: {
      ...input.context,
      responseEventType:
        resolveEmittedEventType(input.responseEvent as WebhookEmittedEvent) ??
        input.responseEvent.type,
    },
    request: [input.responseEvent],
    successMessage: input.successMessage,
    failureMessage: input.failureMessage,
    missingCredentialsMessage: input.missingCredentialsMessage,
  });
};

type TransferResponseMessages = {
  successMessage: string;
  failureMessage: string;
  missingCredentialsMessage: string;
};

const emitTransferGuarantorResponse = async (input: {
  context: TransferContext;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  requestId?: string;
  responseEvent: Record<string, unknown>;
  messages: TransferResponseMessages;
}): Promise<boolean> => {
  const {
    context: { sessionId, eventId, payNoteDocumentId, deps, logs },
    eventType,
    requestId,
    responseEvent,
    messages,
  } = input;

  return emitGuarantorResponseEvent({
    sessionId,
    responseEvent,
    successMessage: messages.successMessage,
    failureMessage: messages.failureMessage,
    missingCredentialsMessage: messages.missingCredentialsMessage,
    context: {
      eventId,
      payNoteDocumentId,
      eventType,
      requestId,
    },
    deps,
    logs,
  });
};

const emitTransferGuarantorResponseSafely = async (input: {
  context: TransferContext;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  requestId?: string;
  responseEvent: Record<string, unknown>;
  messages: TransferResponseMessages;
  unexpectedFailureMessage: string;
}): Promise<void> => {
  const {
    context: { eventId, payNoteDocumentId, logs },
    eventType,
    requestId,
    unexpectedFailureMessage,
  } = input;

  try {
    await emitTransferGuarantorResponse(input);
  } catch (error) {
    logs.push({
      level: 'error',
      message: unexpectedFailureMessage,
      context: {
        eventId,
        payNoteDocumentId,
        eventType,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
};

const resolveFailureReason = (
  error: unknown,
  fallbackReason: string
): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallbackReason;
};

const emitDeclinedDueToMandate = async (input: {
  context: TransferContext;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  requestId?: string;
  reason: string;
}): Promise<void> => {
  const responseEventType =
    input.eventType === RESERVE_FUNDS_EVENT_NAME
      ? RESERVATION_DECLINED_EVENT_NAME
      : CAPTURE_DECLINED_EVENT_NAME;

  await emitTransferGuarantorResponse({
    context: input.context,
    eventType: input.eventType,
    requestId: input.requestId,
    responseEvent: buildResponseEvent({
      type: responseEventType,
      requestId: input.requestId,
      reason: input.reason,
    }),
    messages: {
      successMessage: `Reported PayNote ${
        input.eventType === RESERVE_FUNDS_EVENT_NAME
          ? 'reservation declined'
          : 'capture declined'
      } via guarantorUpdate`,
      failureMessage: `Failed to report PayNote ${
        input.eventType === RESERVE_FUNDS_EVENT_NAME
          ? 'reservation declined'
          : 'capture declined'
      } via guarantorUpdate`,
      missingCredentialsMessage: `Skipped PayNote ${
        input.eventType === RESERVE_FUNDS_EVENT_NAME
          ? 'reservation declined'
          : 'capture declined'
      } update (missing MyOS credentials)`,
    },
  });
};

const handleCaptureImmediately = async (input: {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
  eventIndex: number;
  transferAmountMinor: number;
  authorizedMandate?: TransferMandateAuthorization;
}): Promise<void> => {
  const {
    context: {
      eventId,
      payNoteDocumentId,
      payerAccountNumber,
      payeeAccountNumber,
      transferDescription,
      deps,
      logs,
    },
    account,
    event,
    eventIndex,
    transferAmountMinor,
  } = input;
  const requestId = resolveRequestId(event);
  const idempotencyKey = buildTransferOperationIdempotencyKey({
    payNoteDocumentId,
    eventId,
    eventIndex,
    operation: 'capture-immediately',
    requestId,
  });
  const eventType = CAPTURE_IMMEDIATELY_EVENT_NAME;

  if (!payeeAccountNumber) {
    logs.push({
      level: 'warn',
      message: 'PayNote capture immediately request declined',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        reason: 'Missing counterparty account number',
      },
    });
    await emitTransferGuarantorResponse({
      context: input.context,
      eventType,
      requestId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_DECLINED_EVENT_NAME,
        requestId,
        reason: 'Missing counterparty account number',
      }),
      messages: {
        successMessage: 'Reported PayNote capture declined via guarantorUpdate',
        failureMessage:
          'Failed to report PayNote capture declined via guarantorUpdate',
        missingCredentialsMessage:
          'Skipped PayNote capture declined update (missing MyOS credentials)',
      },
    });
    return;
  }

  const mandateAuthorization = input.authorizedMandate
    ? ({
        ok: true,
        authorization: input.authorizedMandate,
      } as const)
    : await authorizeTransferViaMandateIfRequired({
        context: input.context,
        event,
        eventType,
        eventIndex,
        amountMinor: transferAmountMinor,
        payerAccountNumber: account.accountNumber,
        payeeAccountNumber,
      });
  if (!mandateAuthorization.ok) {
    if (mandateAuthorization.pending) {
      logs.push({
        level: 'info',
        message:
          'Deferred PayNote capture immediately request until payment mandate authorization response',
        context: {
          eventId,
          payNoteDocumentId,
          requestId: requestId ?? null,
          eventIndex,
        },
      });
      return;
    }
    await emitDeclinedDueToMandate({
      context: input.context,
      eventType,
      requestId,
      reason: mandateAuthorization.reason,
    });
    return;
  }

  if (mandateAuthorization.authorization) {
    const firstProcess = await reserveTransferMandateAttemptProcessing({
      context: input.context,
      eventType,
      eventIndex,
      requestId,
      authorization: mandateAuthorization.authorization,
    });
    if (!firstProcess) {
      return;
    }
  }

  logs.push({
    level: 'info',
    message: 'PayNote capture immediately request received',
    context: {
      eventId,
      payNoteDocumentId,
      requestId,
      payerAccountId: account.id,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
      idempotencyKey,
    },
  });

  try {
    await deps.bankingFacade.transferFunds({
      sourceAccountId: account.id,
      destinationAccountNumber: payeeAccountNumber,
      amountMinor: transferAmountMinor,
      description: transferDescription,
      userId: account.ownerUserId,
      idempotencyKey,
      payNoteDocumentId,
    });
  } catch (error) {
    const reason = resolveFailureReason(
      error,
      'Unable to capture funds immediately'
    );

    if (mandateAuthorization.authorization) {
      await runTransferMandateSettlement({
        context: input.context,
        eventType,
        eventIndex,
        requestId,
        authorization: mandateAuthorization.authorization,
        amountMinor: transferAmountMinor,
        status: 'failed',
        reason,
      });
    }

    logs.push({
      level: 'warn',
      message: 'PayNote capture immediately request failed',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        reason,
      },
    });

    await emitTransferGuarantorResponse({
      context: input.context,
      eventType,
      requestId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_FAILED_EVENT_NAME,
        requestId,
        reason,
      }),
      messages: {
        successMessage: 'Reported PayNote capture failed via guarantorUpdate',
        failureMessage:
          'Failed to report PayNote capture failed via guarantorUpdate',
        missingCredentialsMessage:
          'Skipped PayNote capture failed update (missing MyOS credentials)',
      },
    });
    return;
  }

  if (mandateAuthorization.authorization) {
    await runTransferMandateSettlement({
      context: input.context,
      eventType,
      eventIndex,
      requestId,
      authorization: mandateAuthorization.authorization,
      amountMinor: transferAmountMinor,
      status: 'succeeded',
    });
  }

  await emitTransferGuarantorResponseSafely({
    context: input.context,
    eventType,
    requestId,
    responseEvent: buildResponseEvent({
      type: FUNDS_CAPTURED_EVENT_NAME,
      requestId,
      amountField: 'amountCaptured',
      amount: transferAmountMinor,
    }),
    messages: {
      successMessage: 'Reported PayNote funds captured via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote funds captured via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote funds captured update (missing MyOS credentials)',
    },
    unexpectedFailureMessage:
      'PayNote immediate capture succeeded but guarantorUpdate reporting failed unexpectedly',
  });
};

const handleReserveFundsRequest = async (input: {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
  eventIndex: number;
  transferAmountMinor: number;
  authorizedMandate?: TransferMandateAuthorization;
}): Promise<void> => {
  const {
    context: {
      eventId,
      payNoteDocumentId,
      sessionId,
      eventObject,
      emittedEvents,
      payerAccountNumber,
      payeeAccountNumber,
      updatedRecord,
      deliveryRecord,
      deps,
      logs,
    },
    account,
    event,
    eventIndex,
    transferAmountMinor,
  } = input;

  const requestId = resolveRequestId(event);
  const idempotencyKey = buildTransferOperationIdempotencyKey({
    payNoteDocumentId,
    eventId,
    eventIndex,
    operation: 'reserve-funds',
    requestId,
  });
  const eventType = RESERVE_FUNDS_EVENT_NAME;
  const reserveHoldId = updatedRecord.holdId ?? payNoteDocumentId;

  logs.push({
    level: 'info',
    message: 'PayNote reserve funds request received',
    context: {
      eventId,
      payNoteDocumentId,
      requestId,
      payerAccountId: account.id,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
      idempotencyKey,
    },
  });

  if (!payerAccountNumber) {
    throw new Error('Missing payer account number');
  }

  const mandateAuthorization = input.authorizedMandate
    ? ({
        ok: true,
        authorization: input.authorizedMandate,
      } as const)
    : await authorizeTransferViaMandateIfRequired({
        context: input.context,
        event,
        eventType,
        eventIndex,
        amountMinor: transferAmountMinor,
        payerAccountNumber,
        payeeAccountNumber,
      });
  if (!mandateAuthorization.ok) {
    if (mandateAuthorization.pending) {
      logs.push({
        level: 'info',
        message:
          'Deferred PayNote reserve funds request until payment mandate authorization response',
        context: {
          eventId,
          payNoteDocumentId,
          requestId: requestId ?? null,
          eventIndex,
        },
      });
      return;
    }
    await emitDeclinedDueToMandate({
      context: input.context,
      eventType,
      requestId,
      reason: mandateAuthorization.reason,
    });
    return;
  }

  if (mandateAuthorization.authorization) {
    const firstProcess = await reserveTransferMandateAttemptProcessing({
      context: input.context,
      eventType,
      eventIndex,
      requestId,
      authorization: mandateAuthorization.authorization,
    });
    if (!firstProcess) {
      return;
    }
  }

  try {
    await deps.bankingFacade.reserveFunds({
      holdId: reserveHoldId,
      payerAccountNumber,
      amountMinor: transferAmountMinor,
      counterpartyAccountNumber: payeeAccountNumber,
      userId: account.ownerUserId,
      idempotencyKey,
      payNoteDocumentId,
    });
  } catch (error) {
    const reason = resolveFailureReason(error, 'Unable to reserve funds');

    if (mandateAuthorization.authorization) {
      await runTransferMandateSettlement({
        context: input.context,
        eventType,
        eventIndex,
        requestId,
        authorization: mandateAuthorization.authorization,
        amountMinor: transferAmountMinor,
        status: 'failed',
        reason,
        holdId: reserveHoldId,
      });
    }

    logs.push({
      level: 'warn',
      message: 'PayNote reserve funds request declined',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        reason,
      },
    });

    await emitTransferGuarantorResponse({
      context: input.context,
      eventType,
      requestId,
      responseEvent: buildResponseEvent({
        type: RESERVATION_DECLINED_EVENT_NAME,
        requestId,
        reason,
      }),
      messages: {
        successMessage:
          'Reported PayNote reservation declined via guarantorUpdate',
        failureMessage:
          'Failed to report PayNote reservation declined via guarantorUpdate',
        missingCredentialsMessage:
          'Skipped PayNote reservation declined update (missing MyOS credentials)',
      },
    });
    return;
  }

  if (mandateAuthorization.authorization) {
    await runTransferMandateSettlement({
      context: input.context,
      eventType,
      eventIndex,
      requestId,
      authorization: mandateAuthorization.authorization,
      amountMinor: transferAmountMinor,
      status: 'succeeded',
      holdId: reserveHoldId,
    });
  }

  const holdWasMissing = !updatedRecord.holdId;
  let shouldPersistRecord = false;

  if (holdWasMissing) {
    updatedRecord.holdId = reserveHoldId;
    shouldPersistRecord = true;
  }

  const updatedAt = deps.clock.now().toISOString();
  if (mandateAuthorization.authorization) {
    const mappingUpdated = upsertTransferMandateHoldAttempt({
      updatedRecord,
      holdId: reserveHoldId,
      authorization: mandateAuthorization.authorization,
      updatedAt,
    });
    shouldPersistRecord = shouldPersistRecord || mappingUpdated;
  }

  if (shouldPersistRecord) {
    updatedRecord.updatedAt = updatedAt;
    await deps.payNoteRepository.savePayNote(updatedRecord);

    if (holdWasMissing) {
      await upsertPayNoteContract({
        updatedRecord,
        deliveryRecord,
        sessionId,
        payNoteDocumentId,
        eventType,
        triggerEvent: eventObject?.triggeredBy,
        emittedEvents,
        now: updatedAt,
        deps,
      });

      if (deliveryRecord && !deliveryRecord.holdId) {
        await deps.payNoteDeliveryRepository.saveDelivery({
          ...deliveryRecord,
          holdId: reserveHoldId,
          updatedAt,
        });
      }
    }
  }

  await emitTransferGuarantorResponseSafely({
    context: input.context,
    eventType,
    requestId,
    responseEvent: buildResponseEvent({
      type: FUNDS_RESERVED_EVENT_NAME,
      requestId,
      amountField: 'amountReserved',
      amount: transferAmountMinor,
    }),
    messages: {
      successMessage: 'Reported PayNote funds reserved via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote funds reserved via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote funds reserved update (missing MyOS credentials)',
    },
    unexpectedFailureMessage:
      'PayNote funds reserved but guarantorUpdate reporting failed unexpectedly',
  });
};

const handleCaptureFundsRequest = async (input: {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
  eventIndex: number;
  transferAmountMinor: number;
  authorizedMandate?: TransferMandateAuthorization;
}): Promise<void> => {
  const {
    context: {
      eventId,
      payNoteDocumentId,
      sessionId,
      eventObject,
      emittedEvents,
      payeeAccountNumber,
      updatedRecord,
      deliveryRecord,
      deps,
      logs,
    },
    account,
    event,
    eventIndex,
    transferAmountMinor,
  } = input;

  const requestId = resolveRequestId(event);
  const idempotencyKey = buildTransferOperationIdempotencyKey({
    payNoteDocumentId,
    eventId,
    eventIndex,
    operation: 'capture-funds',
    requestId,
  });
  const eventType = CAPTURE_FUNDS_EVENT_NAME;

  const counterpartyAccountNumber =
    payeeAccountNumber ??
    (await resolveMerchantCounterpartyAccountNumber(input.context));

  logs.push({
    level: 'info',
    message: 'PayNote capture funds request received',
    context: {
      eventId,
      payNoteDocumentId,
      requestId,
      payerAccountId: account.id,
      payeeAccountNumber: counterpartyAccountNumber,
      transferAmountMinor,
      idempotencyKey,
    },
  });

  const captureHoldId = updatedRecord.holdId;
  if (!captureHoldId) {
    logs.push({
      level: 'warn',
      message: 'PayNote capture funds request declined',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        reason: 'Missing hold mapping',
      },
    });

    await emitTransferGuarantorResponse({
      context: input.context,
      eventType,
      requestId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_DECLINED_EVENT_NAME,
        requestId,
        reason: 'Missing hold mapping',
      }),
      messages: {
        successMessage: 'Reported PayNote capture declined via guarantorUpdate',
        failureMessage:
          'Failed to report PayNote capture declined via guarantorUpdate',
        missingCredentialsMessage:
          'Skipped PayNote capture declined update (missing MyOS credentials)',
      },
    });
    return;
  }

  const requestedMandateDocumentId =
    resolveTransferPaymentMandateDocumentId(event);
  const storedMandateAuthorization = resolveStoredTransferMandateAuthorization({
    updatedRecord,
    holdId: captureHoldId,
    requestedMandateDocumentId,
  });
  if (storedMandateAuthorization && !storedMandateAuthorization.ok) {
    await emitDeclinedDueToMandate({
      context: input.context,
      eventType,
      requestId,
      reason: storedMandateAuthorization.reason,
    });
    return;
  }

  const mandateAuthorization = input.authorizedMandate
    ? ({
        ok: true,
        authorization: input.authorizedMandate,
      } as const)
    : storedMandateAuthorization && storedMandateAuthorization.ok
    ? ({
        ok: true,
        authorization: storedMandateAuthorization.authorization,
      } as const)
    : await authorizeTransferViaMandateIfRequired({
        context: input.context,
        event,
        eventType,
        eventIndex,
        amountMinor: transferAmountMinor,
        payerAccountNumber: account.accountNumber,
        payeeAccountNumber: counterpartyAccountNumber,
      });
  if (!mandateAuthorization.ok) {
    if (mandateAuthorization.pending) {
      logs.push({
        level: 'info',
        message:
          'Deferred PayNote capture funds request until payment mandate authorization response',
        context: {
          eventId,
          payNoteDocumentId,
          requestId: requestId ?? null,
          eventIndex,
          holdId: captureHoldId,
        },
      });
      return;
    }
    await emitDeclinedDueToMandate({
      context: input.context,
      eventType,
      requestId,
      reason: mandateAuthorization.reason,
    });
    return;
  }

  if (mandateAuthorization.authorization) {
    const firstProcess = await reserveTransferMandateAttemptProcessing({
      context: input.context,
      eventType,
      eventIndex,
      requestId,
      authorization: mandateAuthorization.authorization,
    });
    if (!firstProcess) {
      return;
    }
  }

  try {
    const capturedHold = await deps.bankingFacade.captureHold({
      holdId: captureHoldId,
      userId: account.ownerUserId,
      idempotencyKey,
      amountMinor: transferAmountMinor > 0 ? transferAmountMinor : undefined,
      counterpartyAccountNumber,
      payNoteDocumentId,
    });

    const capturedTransactionId = capturedHold.relatedTransactionId;
    const capturedHoldId = capturedHold.holdId;
    const shouldUpdateHoldId =
      Boolean(capturedHoldId) && capturedHoldId !== updatedRecord.holdId;
    const shouldUpdateTransactionId =
      Boolean(capturedTransactionId) &&
      capturedTransactionId !== updatedRecord.transactionId;

    if (shouldUpdateHoldId) {
      updatedRecord.holdId = capturedHoldId;
    }
    if (shouldUpdateTransactionId) {
      updatedRecord.transactionId = capturedTransactionId;
    }

    if (shouldUpdateHoldId || shouldUpdateTransactionId) {
      const updatedAt = deps.clock.now().toISOString();
      updatedRecord.updatedAt = updatedAt;
      await deps.payNoteRepository.savePayNote(updatedRecord);

      await upsertPayNoteContract({
        updatedRecord,
        deliveryRecord,
        sessionId,
        payNoteDocumentId,
        eventType,
        triggerEvent: eventObject?.triggeredBy,
        emittedEvents,
        now: updatedAt,
        deps,
      });

      if (deliveryRecord && shouldUpdateTransactionId) {
        await deps.payNoteDeliveryRepository.saveDelivery({
          ...deliveryRecord,
          transactionId: updatedRecord.transactionId,
          updatedAt,
        });
      }
    }

    if (mandateAuthorization.authorization) {
      await runTransferMandateSettlement({
        context: input.context,
        eventType,
        eventIndex,
        requestId,
        authorization: mandateAuthorization.authorization,
        amountMinor: transferAmountMinor,
        status: 'succeeded',
        holdId: capturedHoldId,
        transactionId:
          typeof capturedTransactionId === 'string'
            ? capturedTransactionId
            : undefined,
      });
    }
  } catch (error) {
    const reason = resolveFailureReason(error, 'Unable to capture funds');

    if (mandateAuthorization.authorization) {
      await runTransferMandateSettlement({
        context: input.context,
        eventType,
        eventIndex,
        requestId,
        authorization: mandateAuthorization.authorization,
        amountMinor: transferAmountMinor,
        status: 'failed',
        reason,
        holdId: captureHoldId,
      });
    }

    logs.push({
      level: 'warn',
      message: 'PayNote capture funds request failed',
      context: {
        eventId,
        payNoteDocumentId,
        requestId,
        reason,
      },
    });

    await emitTransferGuarantorResponse({
      context: input.context,
      eventType,
      requestId,
      responseEvent: buildResponseEvent({
        type: CAPTURE_FAILED_EVENT_NAME,
        requestId,
        reason,
      }),
      messages: {
        successMessage: 'Reported PayNote capture failed via guarantorUpdate',
        failureMessage:
          'Failed to report PayNote capture failed via guarantorUpdate',
        missingCredentialsMessage:
          'Skipped PayNote capture failed update (missing MyOS credentials)',
      },
    });
    return;
  }

  await emitTransferGuarantorResponseSafely({
    context: input.context,
    eventType,
    requestId,
    responseEvent: buildResponseEvent({
      type: FUNDS_CAPTURED_EVENT_NAME,
      requestId,
      amountField: 'amountCaptured',
      amount: transferAmountMinor,
    }),
    messages: {
      successMessage: 'Reported PayNote funds captured via guarantorUpdate',
      failureMessage:
        'Failed to report PayNote funds captured via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped PayNote funds captured update (missing MyOS credentials)',
    },
    unexpectedFailureMessage:
      'PayNote funds captured but guarantorUpdate reporting failed unexpectedly',
  });
};

const emitDeclinedDueToMissingPayer = async (input: {
  context: TransferContext;
  event: WebhookEmittedEvent;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
}): Promise<void> => {
  const {
    context: { eventId, payNoteDocumentId, logs },
    event,
    eventType,
  } = input;
  const requestId = resolveRequestId(event);
  const responseEventType =
    eventType === RESERVE_FUNDS_EVENT_NAME
      ? RESERVATION_DECLINED_EVENT_NAME
      : CAPTURE_DECLINED_EVENT_NAME;

  logs.push({
    level: 'warn',
    message: 'PayNote request declined (missing payer account mapping)',
    context: {
      eventId,
      payNoteDocumentId,
      eventType,
      requestId,
    },
  });

  await emitTransferGuarantorResponseSafely({
    context: input.context,
    eventType,
    requestId,
    responseEvent: buildResponseEvent({
      type: responseEventType,
      requestId,
      reason: 'Missing payer account mapping',
    }),
    messages: {
      successMessage: `Reported PayNote ${
        eventType === RESERVE_FUNDS_EVENT_NAME
          ? 'reservation declined'
          : 'capture declined'
      } via guarantorUpdate`,
      failureMessage: `Failed to report PayNote ${
        eventType === RESERVE_FUNDS_EVENT_NAME
          ? 'reservation declined'
          : 'capture declined'
      } via guarantorUpdate`,
      missingCredentialsMessage: `Skipped PayNote ${
        eventType === RESERVE_FUNDS_EVENT_NAME
          ? 'reservation declined'
          : 'capture declined'
      } update (missing MyOS credentials)`,
    },
    unexpectedFailureMessage:
      'Failed to report PayNote decline due to missing payer mapping unexpectedly',
  });
};

type ResolvedTransferFromMandateAttempt = {
  context: TransferContext;
  account: BankingAccount & { ownerUserId: string };
  event: WebhookEmittedEvent;
  eventType:
    | typeof RESERVE_FUNDS_EVENT_NAME
    | typeof CAPTURE_FUNDS_EVENT_NAME
    | typeof CAPTURE_IMMEDIATELY_EVENT_NAME;
  eventIndex: number;
  transferAmountMinor: number;
};

const resolveTransferFromMandateAttempt = async (input: {
  chargeAttemptId: string;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<ResolvedTransferFromMandateAttempt | null> => {
  const attempt = parseChargeAttemptId(input.chargeAttemptId);
  if (!attempt) {
    input.logs.push({
      level: 'warn',
      message: 'Ignored transfer mandate response (invalid chargeAttemptId)',
      context: {
        chargeAttemptId: input.chargeAttemptId,
      },
    });
    return null;
  }

  const fetchedEvent = await input.deps.myOsClient.fetchEvent(attempt.eventId);
  if (fetchedEvent.kind !== 'success') {
    input.logs.push({
      level: 'warn',
      message:
        'Ignored transfer mandate response (unable to load originating event)',
      context: {
        chargeAttemptId: input.chargeAttemptId,
        originatingEventId: attempt.eventId,
        reason: fetchedEvent.kind,
      },
    });
    return null;
  }

  const contextResolution = resolveWebhookContext(
    fetchedEvent.payload as Record<string, unknown>,
    attempt.eventId,
    []
  );
  if ('result' in contextResolution) {
    input.logs.push({
      level: 'warn',
      message:
        'Ignored transfer mandate response (invalid originating payload)',
      context: {
        chargeAttemptId: input.chargeAttemptId,
        originatingEventId: attempt.eventId,
      },
    });
    return null;
  }

  const originatingContext = contextResolution.context;
  const originatingEvent = originatingContext.events.at(attempt.eventIndex);
  if (!originatingEvent) {
    input.logs.push({
      level: 'warn',
      message:
        'Ignored transfer mandate response (originating emitted event not found)',
      context: {
        chargeAttemptId: input.chargeAttemptId,
        originatingEventId: attempt.eventId,
        originatingEventIndex: attempt.eventIndex,
      },
    });
    return null;
  }

  const originatingEventType = resolveEmittedEventType(originatingEvent);
  if (!isTransferEventType(originatingEventType)) {
    return null;
  }

  const payNoteRecord =
    (await input.deps.payNoteRepository.getPayNote(
      attempt.payNoteDocumentId
    )) ??
    (await input.deps.payNoteRepository.getPayNoteBySessionId(
      originatingContext.sessionId
    ));
  if (!payNoteRecord) {
    input.logs.push({
      level: 'warn',
      message: 'Ignored transfer mandate response (missing PayNote record)',
      context: {
        chargeAttemptId: input.chargeAttemptId,
        payNoteDocumentId: attempt.payNoteDocumentId,
      },
    });
    return null;
  }

  const canonicalContract =
    await input.deps.contractRepository.getContractByDocumentId(
      attempt.payNoteDocumentId
    );
  const canonicalSessionId = getString(canonicalContract?.sessionId);
  if (
    canonicalSessionId &&
    originatingContext.sessionId !== canonicalSessionId
  ) {
    input.logs.push({
      level: 'warn',
      message:
        'Ignored transfer mandate response (originating event from non-canonical session)',
      context: {
        chargeAttemptId: input.chargeAttemptId,
        payNoteDocumentId: attempt.payNoteDocumentId,
        originatingSessionId: originatingContext.sessionId,
        canonicalSessionId,
      },
    });
    return null;
  }

  const resolvedSessionId = canonicalSessionId ?? originatingContext.sessionId;
  const deliveryRecord = await resolveDeliveryRecord(
    payNoteRecord,
    attempt.payNoteDocumentId,
    input.deps
  );
  const payerAccountNumber =
    payNoteRecord.payerAccountNumber ??
    payNoteRecord.accountNumber ??
    deliveryRecord?.accountNumber;
  if (!payerAccountNumber) {
    input.logs.push({
      level: 'warn',
      message: 'Ignored transfer mandate response (missing payer account)',
      context: {
        chargeAttemptId: input.chargeAttemptId,
        payNoteDocumentId: attempt.payNoteDocumentId,
      },
    });
    return null;
  }

  const accountResolution = await resolvePayerAccount({
    payerAccountNumber,
    eventId: attempt.eventId,
    deps: input.deps,
    logs: input.logs,
  });
  if ('result' in accountResolution) {
    return null;
  }

  const documentRecord = toSimpleRecord(originatingContext.document);
  const transferContext: TransferContext = {
    eventId: attempt.eventId,
    payNoteDocumentId: attempt.payNoteDocumentId,
    sessionId: resolvedSessionId,
    eventObject: originatingContext.eventObject,
    emittedEvents: originatingContext.emittedEvents,
    payerAccountNumber,
    payeeAccountNumber: payNoteRecord.payeeAccountNumber,
    transferDescription: getString(documentRecord?.name) ?? 'PayNote transfer',
    updatedRecord: { ...payNoteRecord },
    deliveryRecord,
    deps: input.deps,
    logs: input.logs,
  };

  return {
    context: transferContext,
    account: accountResolution.account,
    event: originatingEvent,
    eventType: originatingEventType,
    eventIndex: attempt.eventIndex,
    transferAmountMinor:
      typeof originatingEvent.amount?.value === 'number'
        ? originatingEvent.amount.value
        : 0,
  };
};

export const handleTransferMandateResponseEvents = async (input: {
  events: DispatchedTransferEvent[];
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<HandleWebhookEventResult | null> => {
  const { events, eventId, payNoteDocumentId, sessionId, deps, logs } = input;

  for (const item of events) {
    if (item.eventType !== MANDATE_SPEND_AUTHORIZATION_RESPONDED_EVENT_NAME) {
      continue;
    }

    const response = parseTransferMandateAuthorizationResponse(item.event);
    if (!response) {
      logs.push({
        level: 'warn',
        message: 'Ignored transfer mandate response (invalid payload)',
        context: {
          eventId,
          mandateDocumentId: payNoteDocumentId,
          mandateSessionId: sessionId,
          eventIndex: item.eventIndex,
        },
      });
      continue;
    }

    const resolved = await resolveTransferFromMandateAttempt({
      chargeAttemptId: response.chargeAttemptId,
      deps,
      logs,
    });
    if (!resolved) {
      continue;
    }

    const authorization: TransferMandateAuthorization = {
      chargeAttemptId: response.chargeAttemptId,
      mandateDocumentId: payNoteDocumentId,
      mandateSessionId: sessionId,
    };
    const requestId = resolveRequestId(resolved.event);

    if (response.status === 'rejected') {
      const firstProcess = await reserveTransferMandateAttemptProcessing({
        context: resolved.context,
        eventType: resolved.eventType,
        eventIndex: resolved.eventIndex,
        requestId,
        authorization,
      });
      if (!firstProcess) {
        continue;
      }

      await emitDeclinedDueToMandate({
        context: resolved.context,
        eventType: resolved.eventType,
        requestId,
        reason:
          response.reason ?? 'Payment mandate rejected transfer authorization.',
      });
      continue;
    }

    if (resolved.eventType === CAPTURE_IMMEDIATELY_EVENT_NAME) {
      await handleCaptureImmediately({
        context: resolved.context,
        account: resolved.account,
        event: resolved.event,
        eventIndex: resolved.eventIndex,
        transferAmountMinor: resolved.transferAmountMinor,
        authorizedMandate: authorization,
      });
      continue;
    }

    if (resolved.eventType === RESERVE_FUNDS_EVENT_NAME) {
      await handleReserveFundsRequest({
        context: resolved.context,
        account: resolved.account,
        event: resolved.event,
        eventIndex: resolved.eventIndex,
        transferAmountMinor: resolved.transferAmountMinor,
        authorizedMandate: authorization,
      });
      continue;
    }

    if (resolved.eventType === CAPTURE_FUNDS_EVENT_NAME) {
      await handleCaptureFundsRequest({
        context: resolved.context,
        account: resolved.account,
        event: resolved.event,
        eventIndex: resolved.eventIndex,
        transferAmountMinor: resolved.transferAmountMinor,
        authorizedMandate: authorization,
      });
    }
  }

  return null;
};

const logIgnoredTransferEvent = (
  context: TransferContext,
  eventIndex: number,
  eventType: string | undefined,
  transferAmountMinor: number
) => {
  const { eventId, payerAccountNumber, payeeAccountNumber, logs } = context;

  logs.push({
    level: 'info',
    message: 'PayNote webhook event ignored',
    context: {
      eventId,
      eventIndex,
      eventType,
      payerAccountNumber,
      payeeAccountNumber,
      transferAmountMinor,
    },
  });
};

export const handleTransferEvents = async (input: {
  events: TransferEventWithMetadata[];
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  eventObject?: WebhookEventObject;
  emittedEvents?: WebhookEmittedEvent[];
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
  transferDescription: string;
  updatedRecord: PayNoteRecord;
  deliveryRecord: PayNoteDeliveryRecord | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<HandleWebhookEventResult | null> => {
  const {
    events,
    eventId,
    payNoteDocumentId,
    sessionId,
    eventObject,
    emittedEvents,
    payerAccountNumber,
    payeeAccountNumber,
    transferDescription,
    updatedRecord,
    deliveryRecord,
    deps,
    logs,
  } = input;

  const transferContext: TransferContext = {
    eventId,
    payNoteDocumentId,
    sessionId,
    eventObject,
    emittedEvents,
    payerAccountNumber,
    payeeAccountNumber,
    transferDescription,
    updatedRecord,
    deliveryRecord,
    deps,
    logs,
  };

  try {
    const needsPayerResolution = events.some(transferEvent => {
      const eventType =
        transferEvent.eventType ?? resolveEmittedEventType(transferEvent.event);
      return isTransferEventType(eventType);
    });

    let resolvedAccount: (BankingAccount & { ownerUserId: string }) | null =
      null;
    if (needsPayerResolution && payerAccountNumber) {
      const accountResolution = await resolvePayerAccount({
        payerAccountNumber,
        eventId,
        deps,
        logs,
      });

      if ('result' in accountResolution) {
        for (const transferEvent of events) {
          const eventType =
            transferEvent.eventType ??
            resolveEmittedEventType(transferEvent.event);
          if (!isTransferEventType(eventType)) {
            continue;
          }

          const shouldProcess = await reserveTransferRequestProcessing({
            payNoteDocumentId,
            eventType,
            eventId,
            eventIndex: transferEvent.eventIndex,
            requestId: resolveRequestId(transferEvent.event),
            deps,
            logs,
          });
          if (!shouldProcess) {
            continue;
          }

          await emitDeclinedDueToMissingPayer({
            context: transferContext,
            event: transferEvent.event,
            eventType,
          });
        }
        return accountResolution.result;
      }

      resolvedAccount = accountResolution.account;
      await syncPayNoteRecordAccount({
        updatedRecord,
        account: resolvedAccount,
        deps,
      });
    }

    for (const transferEvent of events) {
      const event = transferEvent.event;
      const transferAmountMinor: number = event.amount?.value ?? 0;
      const eventType =
        transferEvent.eventType ?? resolveEmittedEventType(event);
      const { eventIndex } = transferEvent;

      if (
        eventType === CAPTURE_LOCK_REQUESTED_EVENT_NAME ||
        eventType === CAPTURE_UNLOCK_REQUESTED_EVENT_NAME
      ) {
        continue;
      }

      if (isTransferEventType(eventType)) {
        const shouldProcess = await reserveTransferRequestProcessing({
          payNoteDocumentId,
          eventType,
          eventId,
          eventIndex,
          requestId: resolveRequestId(event),
          deps,
          logs,
        });
        if (!shouldProcess) {
          continue;
        }

        if (!payerAccountNumber || !resolvedAccount) {
          await emitDeclinedDueToMissingPayer({
            context: transferContext,
            event,
            eventType,
          });
          continue;
        }
      }

      if (eventType === CAPTURE_IMMEDIATELY_EVENT_NAME) {
        const account = resolvedAccount;
        if (!account) {
          continue;
        }
        await handleCaptureImmediately({
          context: transferContext,
          account,
          event,
          eventIndex,
          transferAmountMinor,
        });
        continue;
      }

      if (eventType === RESERVE_FUNDS_EVENT_NAME) {
        const account = resolvedAccount;
        if (!account) {
          continue;
        }
        await handleReserveFundsRequest({
          context: transferContext,
          account,
          event,
          eventIndex,
          transferAmountMinor,
        });
        continue;
      }

      if (eventType === CAPTURE_FUNDS_EVENT_NAME) {
        const account = resolvedAccount;
        if (!account) {
          continue;
        }
        await handleCaptureFundsRequest({
          context: transferContext,
          account,
          event,
          eventIndex,
          transferAmountMinor,
        });
        continue;
      }

      logIgnoredTransferEvent(
        transferContext,
        eventIndex,
        eventType,
        transferAmountMinor
      );
    }
  } catch (error) {
    const note = logAndReturn(
      logs,
      'error',
      'Unexpected error preparing PayNote capture transfer',
      {
        eventId,
        payerAccountNumber,
        payeeAccountNumber,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return { note, logs };
  }

  return null;
};
