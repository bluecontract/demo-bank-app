import {
  MerchantToCustomerPayNoteSchema,
  PaymentMandateSchema,
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
  RESERVE_FUNDS_EVENT_NAME,
  resolveEmittedEventType,
  resolveTransferPaymentMandateDocumentId,
  resolveTransferRequestId,
} from './events';
import { logAndReturn } from './logging';
import { upsertPayNoteContract } from './records';
import { runGuarantorUpdate } from '../documentOperations';
import type { DispatchedTransferEvent } from './eventDispatcher';
import { blue } from '../../../blue';
import { getString, toSimpleRecord } from './utils';

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
type TransferMandateOperation =
  | 'reserve-funds'
  | 'capture-funds'
  | 'capture-immediately';

type TransferMandateAuthorization = {
  chargeAttemptId: string;
  mandateDocumentId: string;
  mandateSessionId: string;
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
  try {
    const node = blue.jsonValueToNode(value);
    const output = blue.nodeToSchemaOutput(node, PaymentMandateSchema) as
      | Record<string, unknown>
      | undefined;
    const simple = blue.nodeToJson(node, 'simple') as Record<
      string,
      unknown
    > | null;
    if (!simple) {
      return null;
    }

    return {
      revokedAt: getString(output?.revokedAt) ?? getString(simple.revokedAt),
      expiresAt: getString(output?.expiresAt) ?? getString(simple.expiresAt),
      sourceAccount:
        getString(output?.sourceAccount) ?? getString(simple.sourceAccount),
      granterType:
        getString(output?.granterType) ?? getString(simple.granterType),
      chargeAttempts:
        toSimpleRecord(output?.chargeAttempts) ??
        toSimpleRecord(simple.chargeAttempts) ??
        undefined,
    };
  } catch {
    return null;
  }
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

const resolveOperationFailureReason = (input: {
  status: number;
  body?: unknown;
  fallbackPrefix: string;
}): string => {
  const bodyRecord = toSimpleRecord(input.body);
  const detail =
    getString(bodyRecord?.detail) ??
    getString(bodyRecord?.message) ??
    getString(bodyRecord?.error);
  return detail
    ? `${input.fallbackPrefix}: ${detail}`
    : `${input.fallbackPrefix} with status ${input.status}.`;
};

const buildTransferMandateChargeAttemptId = (input: {
  operation: TransferMandateOperation;
  payNoteDocumentId: string;
  eventId: string;
  eventIndex: number;
}) =>
  [
    'paynote-transfer-mandate-attempt',
    input.operation,
    input.payNoteDocumentId,
    input.eventId,
    String(input.eventIndex),
  ].join(':');

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
  operation: TransferMandateOperation;
  amountMinor: number;
  payerAccountNumber: string;
  payeeAccountNumber?: string;
}): Promise<
  | { ok: true; authorization?: TransferMandateAuthorization }
  | { ok: false; reason: string }
> => {
  const {
    context,
    event,
    eventType,
    eventIndex,
    operation,
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
  });
  if (!credentials) {
    return {
      ok: false,
      reason: 'Missing MyOS credentials.',
    };
  }

  const chargeAttemptId = buildTransferMandateChargeAttemptId({
    operation,
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
      reason: 'Payment mandate authorization was not confirmed.',
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
  eventId: string;
  eventIndex: number;
  operation: 'capture-immediately' | 'reserve-funds' | 'capture-funds';
}): string =>
  [
    'paynote-transfer',
    input.operation,
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
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const { payNoteDocumentId, eventType, eventId, eventIndex, deps, logs } =
    input;

  const dedupeEventId = [
    'paynote-transfer-request',
    payNoteDocumentId,
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

const resolveCredentials = async (
  deps: HandleWebhookEventDependencies,
  logs: LogEntry[],
  context: {
    eventId: string;
    payNoteDocumentId: string;
    sessionId: string;
  }
): Promise<Awaited<
  ReturnType<HandleWebhookEventDependencies['myOsClient']['getCredentials']>
> | null> => {
  try {
    return await deps.myOsClient.getCredentials();
  } catch (error) {
    logs.push({
      level: 'error',
      message:
        'Failed to resolve MyOS credentials for PayNote guarantor update',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        sessionId: context.sessionId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
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
    eventId,
    eventIndex,
    operation: 'capture-immediately',
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

  const mandateAuthorization = await authorizeTransferViaMandateIfRequired({
    context: input.context,
    event,
    eventType,
    eventIndex,
    operation: 'capture-immediately',
    amountMinor: transferAmountMinor,
    payerAccountNumber: account.accountNumber,
    payeeAccountNumber,
  });
  if (!mandateAuthorization.ok) {
    await emitDeclinedDueToMandate({
      context: input.context,
      eventType,
      requestId,
      reason: mandateAuthorization.reason,
    });
    return;
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
    eventId,
    eventIndex,
    operation: 'reserve-funds',
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

  const mandateAuthorization = await authorizeTransferViaMandateIfRequired({
    context: input.context,
    event,
    eventType,
    eventIndex,
    operation: 'reserve-funds',
    amountMinor: transferAmountMinor,
    payerAccountNumber,
    payeeAccountNumber,
  });
  if (!mandateAuthorization.ok) {
    await emitDeclinedDueToMandate({
      context: input.context,
      eventType,
      requestId,
      reason: mandateAuthorization.reason,
    });
    return;
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
    eventId,
    eventIndex,
    operation: 'capture-funds',
  });
  const eventType = CAPTURE_FUNDS_EVENT_NAME;

  logs.push({
    level: 'info',
    message: 'PayNote capture funds request received',
    context: {
      eventId,
      payNoteDocumentId,
      requestId,
      payerAccountId: account.id,
      payeeAccountNumber,
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

  const mandateAuthorization =
    storedMandateAuthorization && storedMandateAuthorization.ok
      ? ({
          ok: true,
          authorization: storedMandateAuthorization.authorization,
        } as const)
      : await authorizeTransferViaMandateIfRequired({
          context: input.context,
          event,
          eventType,
          eventIndex,
          operation: 'capture-funds',
          amountMinor: transferAmountMinor,
          payerAccountNumber: account.accountNumber,
          payeeAccountNumber,
        });
  if (!mandateAuthorization.ok) {
    await emitDeclinedDueToMandate({
      context: input.context,
      eventType,
      requestId,
      reason: mandateAuthorization.reason,
    });
    return;
  }

  try {
    const capturedHold = await deps.bankingFacade.captureHold({
      holdId: captureHoldId,
      userId: account.ownerUserId,
      idempotencyKey,
      amountMinor: transferAmountMinor > 0 ? transferAmountMinor : undefined,
      counterpartyAccountNumber: payeeAccountNumber,
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
