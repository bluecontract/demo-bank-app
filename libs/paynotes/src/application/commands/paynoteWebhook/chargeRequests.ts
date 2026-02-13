import type { BlueNode } from '@blue-labs/language';
import {
  CardTransactionPayNoteSchema,
  LinkedCardChargeAndCaptureImmediatelyRequestedSchema,
  LinkedCardChargeRequestedSchema,
  MerchantToCustomerPayNoteSchema,
  PaymentMandateSchema,
  PayNoteSchema,
  ReverseCardChargeAndCaptureImmediatelyRequestedSchema,
  ReverseCardChargeRequestedSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import type {
  BankingAccount,
  LogEntry,
  MyOsCredentials,
  PayNoteDeliveryRecord,
  PayNoteRecord,
} from '../../ports';
import { buildChannelBindingsFromContracts } from '../../payNoteDelivery/blueUtils';
import { blue } from '../../../blue';
import { runGuarantorUpdate } from '../documentOperations';
import type { DispatchedTransferEvent } from './eventDispatcher';
import {
  LINKED_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME,
  LINKED_CARD_CHARGE_REQUESTED_EVENT_NAME,
  REVERSE_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME,
  REVERSE_CARD_CHARGE_REQUESTED_EVENT_NAME,
  resolveChargeRequestId,
} from './events';
import type {
  HandleWebhookEventDependencies,
  HandleWebhookEventResult,
  WebhookEmittedEvent,
  WebhookEventObject,
} from './types';
import { getString, toSimpleRecord } from './utils';

const CARD_CHARGE_RESPONDED_EVENT_NAME = 'PayNote/Card Charge Responded';
const CARD_CHARGE_COMPLETED_EVENT_NAME = 'PayNote/Card Charge Completed';
const LINKED_PAYNOTE_START_RESPONDED_EVENT_NAME =
  'PayNote/Linked PayNote Start Responded';
const LINKED_PAYNOTE_STARTED_EVENT_NAME = 'PayNote/Linked PayNote Started';
const LINKED_PAYNOTE_START_FAILED_EVENT_NAME =
  'PayNote/Linked PayNote Start Failed';

type ChargeRequestEventType =
  | typeof LINKED_CARD_CHARGE_REQUESTED_EVENT_NAME
  | typeof LINKED_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME
  | typeof REVERSE_CARD_CHARGE_REQUESTED_EVENT_NAME
  | typeof REVERSE_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME;

type SourcePayNoteType =
  | 'card-transaction-paynote'
  | 'merchant-to-customer-paynote'
  | 'paynote'
  | 'unknown';

type ChargeDirection = 'linked' | 'reverse';
type ChargeMode = 'authorize-only' | 'authorize-and-capture';

type ParsedChargeRequest = {
  amountMinor: number;
  requestId?: string;
  paymentMandateDocumentId?: string;
  payNoteDocument?: Record<string, unknown>;
};

type ChargeRequestContext = {
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  eventObject?: WebhookEventObject;
  updatedRecord: PayNoteRecord;
  deliveryRecord: PayNoteDeliveryRecord | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
};

type ResolvedChargeAccounts = {
  payerAccountNumber: string;
  payeeAccountNumber?: string;
  payerAccount: BankingAccount & { ownerUserId: string };
};

const SUPPORTED_CHARGE_EVENTS: readonly ChargeRequestEventType[] = [
  LINKED_CARD_CHARGE_REQUESTED_EVENT_NAME,
  LINKED_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME,
  REVERSE_CARD_CHARGE_REQUESTED_EVENT_NAME,
  REVERSE_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME,
];

const SUPPORTED_CHARGE_EVENT_SET = new Set<ChargeRequestEventType>(
  SUPPORTED_CHARGE_EVENTS
);

const CHARGE_EVENT_TYPES = new Set<string>(SUPPORTED_CHARGE_EVENTS);

const CHARGE_CAPABILITY_MATRIX: Record<
  SourcePayNoteType,
  Set<ChargeRequestEventType>
> = {
  'card-transaction-paynote': SUPPORTED_CHARGE_EVENT_SET,
  'merchant-to-customer-paynote': SUPPORTED_CHARGE_EVENT_SET,
  paynote: SUPPORTED_CHARGE_EVENT_SET,
  unknown: new Set<ChargeRequestEventType>(),
};

const withInResponseTo = (
  event: Record<string, unknown>,
  requestId: string | undefined
): Record<string, unknown> => {
  if (!requestId) {
    return event;
  }
  return {
    ...event,
    inResponseTo: {
      requestId,
    },
  };
};

const isChargeRequestEventType = (
  eventType: string | undefined
): eventType is ChargeRequestEventType =>
  Boolean(eventType && CHARGE_EVENT_TYPES.has(eventType));

const resolveChargeMode = (eventType: ChargeRequestEventType): ChargeMode =>
  eventType ===
    LINKED_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME ||
  eventType === REVERSE_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME
    ? 'authorize-and-capture'
    : 'authorize-only';

const resolveChargeDirection = (
  eventType: ChargeRequestEventType
): ChargeDirection =>
  eventType === LINKED_CARD_CHARGE_REQUESTED_EVENT_NAME ||
  eventType === LINKED_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME
    ? 'linked'
    : 'reverse';

const buildChargeRequestDedupeKey = (input: {
  eventId: string;
  eventIndex: number;
}) => `paynote-card-charge-request:${input.eventId}:${input.eventIndex}`;

const buildChargeHoldId = (input: {
  payNoteDocumentId: string;
  eventId: string;
  eventIndex: number;
}) =>
  [
    'paynote-card-charge',
    input.payNoteDocumentId,
    input.eventId,
    String(input.eventIndex),
  ].join(':');

const buildChargeReserveIdempotencyKey = (input: {
  eventId: string;
  eventIndex: number;
}) => `paynote-card-charge:reserve:${input.eventId}:${input.eventIndex}`;

const buildChargeCaptureIdempotencyKey = (input: {
  eventId: string;
  eventIndex: number;
}) => `paynote-card-charge:capture:${input.eventId}:${input.eventIndex}`;

const toPositiveInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const extractPayNoteDocument = (
  value: BlueNode | undefined
): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const restored = blue.restoreInlineTypes(value);
    const original = blue.nodeToJson(restored, 'original');
    return isRecord(original) ? original : undefined;
  } catch {
    return undefined;
  }
};

const CHARGE_REQUEST_SCHEMA_BY_EVENT_TYPE: Record<
  ChargeRequestEventType,
  Parameters<typeof blue.nodeToSchemaOutput>[1]
> = {
  [LINKED_CARD_CHARGE_REQUESTED_EVENT_NAME]: LinkedCardChargeRequestedSchema,
  [LINKED_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME]:
    LinkedCardChargeAndCaptureImmediatelyRequestedSchema,
  [REVERSE_CARD_CHARGE_REQUESTED_EVENT_NAME]: ReverseCardChargeRequestedSchema,
  [REVERSE_CARD_CHARGE_AND_CAPTURE_IMMEDIATELY_REQUESTED_EVENT_NAME]:
    ReverseCardChargeAndCaptureImmediatelyRequestedSchema,
};

type ParsedChargeRequestSchemaOutput = {
  amount?: unknown;
  requestId?: unknown;
  paymentMandateDocumentId?: unknown;
  paynote?: BlueNode;
};

type PaymentMandateSchemaOutput = {
  amountLimit?: unknown;
  allowLinkedPayNote?: unknown;
  granteeType?: unknown;
  granteeId?: unknown;
  granterType?: unknown;
  granterId?: unknown;
  expiresAt?: unknown;
  revokedAt?: unknown;
  allowedPayNotes?: unknown;
};

type ParsedPaymentMandate = {
  amountLimit?: number;
  allowLinkedPayNote?: boolean;
  granteeType?: string;
  granteeId?: string;
  granterType?: string;
  granterId?: string;
  expiresAt?: string;
  revokedAt?: string;
  allowedPayNotes?: Array<{
    typeBlueId?: string;
    documentBlueId?: string;
  }>;
};

const buildParsedChargeRequest = (input: {
  output: ParsedChargeRequestSchemaOutput;
  fallbackAmount?: number;
  event: WebhookEmittedEvent;
}): ParsedChargeRequest | null => {
  const amountMinor =
    toPositiveInteger(input.output.amount) ?? input.fallbackAmount;
  if (!amountMinor) {
    return null;
  }

  return {
    amountMinor,
    requestId:
      getString(input.output.requestId) ?? resolveChargeRequestId(input.event),
    paymentMandateDocumentId: getString(input.output.paymentMandateDocumentId),
    payNoteDocument: extractPayNoteDocument(input.output.paynote),
  };
};

const parseChargeRequest = (
  event: WebhookEmittedEvent,
  eventType: ChargeRequestEventType
): ParsedChargeRequest | null => {
  try {
    const node = blue.jsonValueToNode(event);
    const simple = blue.nodeToJson(node, 'simple') as
      | Record<string, unknown>
      | undefined;
    const fallbackAmount =
      toPositiveInteger(simple?.amount) ??
      toPositiveInteger(event.amount?.value);

    const schema = CHARGE_REQUEST_SCHEMA_BY_EVENT_TYPE[eventType];
    const output = blue.nodeToSchemaOutput(
      node,
      schema
    ) as ParsedChargeRequestSchemaOutput;
    return buildParsedChargeRequest({
      output,
      fallbackAmount,
      event,
    });
  } catch {
    return null;
  }
};

const resolveDocumentTypeBlueId = (
  document: Record<string, unknown>
): string | undefined => {
  try {
    const simple = blue.nodeToJson(
      blue.jsonValueToNode(document),
      'simple'
    ) as { type?: { blueId?: unknown } } | null;
    return getString(simple?.type?.blueId);
  } catch {
    return undefined;
  }
};

const resolveIsoTimestamp = (value: unknown): string | undefined => {
  const direct = getString(value);
  if (direct) {
    return direct;
  }

  const record = toSimpleRecord(value);
  return getString(record?.value);
};

const toNonNegativeInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
};

const parsePaymentMandate = (value: unknown): ParsedPaymentMandate | null => {
  try {
    const node = blue.jsonValueToNode(value);
    const output = blue.nodeToSchemaOutput(
      node,
      PaymentMandateSchema
    ) as PaymentMandateSchemaOutput;

    const allowedPayNotes = Array.isArray(output.allowedPayNotes)
      ? output.allowedPayNotes.reduce<
          Array<{ typeBlueId?: string; documentBlueId?: string }>
        >((acc, item) => {
          const record = toSimpleRecord(item);
          if (!record) {
            return acc;
          }
          const typeBlueId = getString(record.typeBlueId);
          const documentBlueId = getString(record.documentBlueId);
          if (!typeBlueId && !documentBlueId) {
            return acc;
          }
          acc.push({ typeBlueId, documentBlueId });
          return acc;
        }, [])
      : undefined;

    return {
      amountLimit: toNonNegativeInteger(output.amountLimit),
      allowLinkedPayNote:
        typeof output.allowLinkedPayNote === 'boolean'
          ? output.allowLinkedPayNote
          : undefined,
      granteeType: getString(output.granteeType),
      granteeId: getString(output.granteeId),
      granterType: getString(output.granterType),
      granterId: getString(output.granterId),
      expiresAt: resolveIsoTimestamp(output.expiresAt),
      revokedAt: resolveIsoTimestamp(output.revokedAt),
      allowedPayNotes,
    };
  } catch {
    return null;
  }
};

const resolveContextMerchantId = (
  context: ChargeRequestContext
): string | undefined =>
  getString(
    context.deliveryRecord?.merchantId ?? context.updatedRecord.merchantId
  );

const resolveContextCustomerId = (
  context: ChargeRequestContext
): string | undefined =>
  getString(context.deliveryRecord?.userId ?? context.updatedRecord.userId);

const parseDateMs = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
};

const validatePaymentMandateScope = (input: {
  mandate: ParsedPaymentMandate;
  context: ChargeRequestContext;
  request: ParsedChargeRequest;
}): { ok: true } | { ok: false; reason: string } => {
  const { mandate, context, request } = input;

  if (mandate.revokedAt) {
    return {
      ok: false,
      reason: 'Payment mandate is revoked.',
    };
  }

  const expiresAtMs = parseDateMs(mandate.expiresAt);
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

  if (
    mandate.amountLimit !== undefined &&
    request.amountMinor > mandate.amountLimit
  ) {
    return {
      ok: false,
      reason: 'Payment mandate amount limit exceeded.',
    };
  }

  const merchantId = resolveContextMerchantId(context);
  const customerId = resolveContextCustomerId(context);

  if (mandate.granteeType) {
    const expectedGranteeId =
      mandate.granteeType === 'documentId'
        ? context.payNoteDocumentId
        : mandate.granteeType === 'merchantId'
        ? merchantId
        : mandate.granteeType === 'customerId'
        ? customerId
        : undefined;

    if (!expectedGranteeId) {
      return {
        ok: false,
        reason: 'Payment mandate grantee scope is not satisfied.',
      };
    }
    if (!mandate.granteeId || mandate.granteeId !== expectedGranteeId) {
      return {
        ok: false,
        reason:
          'Payment mandate grantee does not match requesting contract context.',
      };
    }
  }

  if (mandate.granterType) {
    const expectedGranterId =
      mandate.granterType === 'merchant'
        ? merchantId
        : mandate.granterType === 'customer'
        ? customerId
        : undefined;
    if (!expectedGranterId) {
      return {
        ok: false,
        reason: 'Payment mandate granter scope is not satisfied.',
      };
    }
    if (!mandate.granterId || mandate.granterId !== expectedGranterId) {
      return {
        ok: false,
        reason:
          'Payment mandate granter does not match requesting contract context.',
      };
    }
  }

  if (request.payNoteDocument) {
    if (mandate.allowLinkedPayNote === false) {
      return {
        ok: false,
        reason: 'Payment mandate does not allow linked PayNote startup.',
      };
    }

    if (mandate.allowedPayNotes && mandate.allowedPayNotes.length > 0) {
      const requestedTypeBlueId = resolveDocumentTypeBlueId(
        request.payNoteDocument
      );
      if (!requestedTypeBlueId) {
        return {
          ok: false,
          reason:
            'Unable to resolve linked PayNote type for payment mandate validation.',
        };
      }
      const allowed = mandate.allowedPayNotes.some(
        item => item.typeBlueId === requestedTypeBlueId
      );
      if (!allowed) {
        return {
          ok: false,
          reason: 'Linked PayNote type is not allowed by payment mandate.',
        };
      }
    }
  }

  return { ok: true };
};

const validatePaymentMandate = async (input: {
  context: ChargeRequestContext;
  request: ParsedChargeRequest;
}): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const mandateDocumentId = input.request.paymentMandateDocumentId;
  if (!mandateDocumentId) {
    return {
      ok: false,
      reason: 'Missing payment mandate document id.',
    };
  }

  const mandateContract =
    await input.context.deps.contractRepository.getContractByDocumentId(
      mandateDocumentId
    );
  const mandateSessionId = getString(mandateContract?.sessionId);
  if (!mandateSessionId) {
    return {
      ok: false,
      reason: 'Unable to resolve payment mandate session id.',
    };
  }

  const mandateDocumentResult =
    await input.context.deps.myOsClient.fetchDocument(mandateSessionId);
  if (mandateDocumentResult.kind !== 'success') {
    return {
      ok: false,
      reason: 'Unable to load payment mandate document.',
    };
  }

  const mandateDocument = mandateDocumentResult.document.document;
  if (!mandateDocument) {
    return {
      ok: false,
      reason: 'Payment mandate document payload is missing.',
    };
  }

  const mandate = parsePaymentMandate(mandateDocument);
  if (!mandate) {
    return {
      ok: false,
      reason: 'Invalid payment mandate document payload.',
    };
  }

  return validatePaymentMandateScope({
    mandate,
    context: input.context,
    request: input.request,
  });
};

const resolveSourcePayNoteType = (document: unknown): SourcePayNoteType => {
  if (!document) {
    return 'unknown';
  }

  try {
    const node = blue.jsonValueToNode(document);
    if (
      blue.isTypeOf(node, CardTransactionPayNoteSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return 'card-transaction-paynote';
    }
    if (
      blue.isTypeOf(node, MerchantToCustomerPayNoteSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return 'merchant-to-customer-paynote';
    }
    if (
      blue.isTypeOf(node, PayNoteSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return 'paynote';
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
};

const resolveCredentials = async (input: {
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
}): Promise<MyOsCredentials | null> => {
  try {
    return await input.deps.myOsClient.getCredentials();
  } catch (error) {
    input.logs.push({
      level: 'error',
      message:
        'Failed to resolve MyOS credentials for PayNote card charge responses',
      context: {
        eventId: input.eventId,
        payNoteDocumentId: input.payNoteDocumentId,
        sessionId: input.sessionId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
};

const emitGuarantorResponseEvent = async (input: {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  requestId?: string;
  responseEvent: Record<string, unknown>;
  successMessage: string;
  failureMessage: string;
  missingCredentialsMessage: string;
}): Promise<boolean> => {
  const { context } = input;
  const credentials = await resolveCredentials({
    deps: context.deps,
    logs: context.logs,
    eventId: context.eventId,
    payNoteDocumentId: context.payNoteDocumentId,
    sessionId: context.sessionId,
  });

  return runGuarantorUpdate({
    myOsClient: context.deps.myOsClient,
    sessionId: context.sessionId,
    credentials,
    logs: context.logs,
    logContext: {
      eventId: context.eventId,
      payNoteDocumentId: context.payNoteDocumentId,
      eventType: input.eventType,
      requestId: input.requestId ?? null,
      responseEventType: input.responseEvent.type,
    },
    request: [input.responseEvent],
    successMessage: input.successMessage,
    failureMessage: input.failureMessage,
    missingCredentialsMessage: input.missingCredentialsMessage,
  });
};

const emitCardChargeResponded = async (input: {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  requestId?: string;
  status: 'accepted' | 'rejected' | 'pending';
  reason?: string;
}) =>
  emitGuarantorResponseEvent({
    context: input.context,
    eventType: input.eventType,
    requestId: input.requestId,
    responseEvent: withInResponseTo(
      {
        type: CARD_CHARGE_RESPONDED_EVENT_NAME,
        status: input.status,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      input.requestId
    ),
    successMessage: `Reported card charge request ${input.status} via guarantorUpdate`,
    failureMessage: `Failed to report card charge request ${input.status} via guarantorUpdate`,
    missingCredentialsMessage:
      'Skipped card charge request response (missing MyOS credentials)',
  });

const emitCardChargeCompleted = async (input: {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  requestId?: string;
  status: 'succeeded' | 'failed';
  holdId?: string;
  transactionId?: string;
  reason?: string;
}) =>
  emitGuarantorResponseEvent({
    context: input.context,
    eventType: input.eventType,
    requestId: input.requestId,
    responseEvent: withInResponseTo(
      {
        type: CARD_CHARGE_COMPLETED_EVENT_NAME,
        status: input.status,
        ...(input.holdId ? { holdId: input.holdId } : {}),
        ...(input.transactionId ? { transactionId: input.transactionId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      },
      input.requestId
    ),
    successMessage: `Reported card charge ${input.status} via guarantorUpdate`,
    failureMessage: `Failed to report card charge ${input.status} via guarantorUpdate`,
    missingCredentialsMessage:
      'Skipped card charge completion response (missing MyOS credentials)',
  });

const emitLinkedPayNoteStartResponded = async (input: {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  requestId?: string;
  status: 'accepted' | 'rejected';
  reason?: string;
}) =>
  emitGuarantorResponseEvent({
    context: input.context,
    eventType: input.eventType,
    requestId: input.requestId,
    responseEvent: withInResponseTo(
      {
        type: LINKED_PAYNOTE_START_RESPONDED_EVENT_NAME,
        status: input.status,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      input.requestId
    ),
    successMessage: `Reported linked PayNote start ${input.status} via guarantorUpdate`,
    failureMessage: `Failed to report linked PayNote start ${input.status} via guarantorUpdate`,
    missingCredentialsMessage:
      'Skipped linked PayNote start response (missing MyOS credentials)',
  });

const emitLinkedPayNoteStarted = async (input: {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  requestId?: string;
  payNoteSessionId: string;
  payNoteDocumentId?: string;
}) =>
  emitGuarantorResponseEvent({
    context: input.context,
    eventType: input.eventType,
    requestId: input.requestId,
    responseEvent: withInResponseTo(
      {
        type: LINKED_PAYNOTE_STARTED_EVENT_NAME,
        payNoteSessionId: input.payNoteSessionId,
        ...(input.payNoteDocumentId
          ? { payNoteDocumentId: input.payNoteDocumentId }
          : {}),
      },
      input.requestId
    ),
    successMessage: 'Reported linked PayNote startup via guarantorUpdate',
    failureMessage:
      'Failed to report linked PayNote startup via guarantorUpdate',
    missingCredentialsMessage:
      'Skipped linked PayNote startup response (missing MyOS credentials)',
  });

const emitLinkedPayNoteStartFailed = async (input: {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  requestId?: string;
  reason: string;
}) =>
  emitGuarantorResponseEvent({
    context: input.context,
    eventType: input.eventType,
    requestId: input.requestId,
    responseEvent: withInResponseTo(
      {
        type: LINKED_PAYNOTE_START_FAILED_EVENT_NAME,
        reason: input.reason,
      },
      input.requestId
    ),
    successMessage:
      'Reported linked PayNote startup failure via guarantorUpdate',
    failureMessage:
      'Failed to report linked PayNote startup failure via guarantorUpdate',
    missingCredentialsMessage:
      'Skipped linked PayNote startup failure response (missing MyOS credentials)',
  });

const resolveAccountWithOwner = async (input: {
  accountNumber: string;
  deps: HandleWebhookEventDependencies;
}): Promise<(BankingAccount & { ownerUserId: string }) | null> => {
  const account = await input.deps.bankingFacade.getAccountByNumber(
    input.accountNumber
  );
  if (!account || !account.ownerUserId) {
    return null;
  }

  return account as BankingAccount & { ownerUserId: string };
};

const resolveMerchantFundingAccountNumber = async (input: {
  context: ChargeRequestContext;
  sourcePayNoteType: SourcePayNoteType;
}): Promise<string | undefined> => {
  const { context, sourcePayNoteType } = input;
  const { updatedRecord, deliveryRecord, deps } = context;

  if (sourcePayNoteType === 'merchant-to-customer-paynote') {
    return getString(updatedRecord.payerAccountNumber);
  }

  const explicitPayee = getString(updatedRecord.payeeAccountNumber);
  if (explicitPayee) {
    return explicitPayee;
  }

  const merchantId = getString(
    deliveryRecord?.merchantId ?? updatedRecord.merchantId
  );
  if (!merchantId) {
    return undefined;
  }

  const resolver = deps.bankingFacade.getActiveCreditLineAccountByUserId;
  if (typeof resolver !== 'function') {
    return undefined;
  }

  const account = await resolver(merchantId);
  return account ? getString(account.accountNumber) : undefined;
};

const resolveRootCustomerAccountNumber = (
  context: ChargeRequestContext
): string | undefined =>
  getString(
    context.deliveryRecord?.accountNumber ??
      context.updatedRecord.accountNumber ??
      context.updatedRecord.payerAccountNumber
  );

const resolveChargeAccounts = async (input: {
  context: ChargeRequestContext;
  sourcePayNoteType: SourcePayNoteType;
  direction: ChargeDirection;
}): Promise<ResolvedChargeAccounts | null> => {
  const { context, sourcePayNoteType, direction } = input;
  const { deps, logs, eventId, payNoteDocumentId } = context;

  const rootCustomerAccountNumber = resolveRootCustomerAccountNumber(context);
  const merchantFundingAccountNumber =
    await resolveMerchantFundingAccountNumber({
      context,
      sourcePayNoteType,
    });

  const payerAccountNumber =
    direction === 'linked'
      ? rootCustomerAccountNumber
      : merchantFundingAccountNumber;
  const payeeAccountNumber =
    direction === 'linked'
      ? merchantFundingAccountNumber
      : rootCustomerAccountNumber;

  if (!payerAccountNumber || !payeeAccountNumber) {
    logs.push({
      level: 'warn',
      message:
        'Card charge request rejected (unable to resolve account mapping)',
      context: {
        eventId,
        payNoteDocumentId,
        direction,
        payerAccountNumber: payerAccountNumber ?? null,
        payeeAccountNumber: payeeAccountNumber ?? null,
        sourcePayNoteType,
      },
    });
    return null;
  }

  const payerAccount = await resolveAccountWithOwner({
    accountNumber: payerAccountNumber,
    deps,
  });
  if (!payerAccount) {
    logs.push({
      level: 'warn',
      message: 'Card charge request rejected (missing payer account mapping)',
      context: {
        eventId,
        payNoteDocumentId,
        direction,
        payerAccountNumber,
        sourcePayNoteType,
      },
    });
    return null;
  }

  return {
    payerAccountNumber,
    payeeAccountNumber,
    payerAccount,
  };
};

const hasCardTransactionChainContext = (
  context: ChargeRequestContext
): boolean => {
  if (context.deliveryRecord) {
    return true;
  }

  const holdId = getString(context.updatedRecord.holdId);
  const transactionId = getString(context.updatedRecord.transactionId);
  return Boolean(holdId || transactionId);
};

const executeCardCharge = async (input: {
  context: ChargeRequestContext;
  accounts: ResolvedChargeAccounts;
  eventType: ChargeRequestEventType;
  amountMinor: number;
  eventIndex: number;
}): Promise<
  | { ok: true; holdId: string; transactionId?: string }
  | { ok: false; reason: string }
> => {
  const { context, accounts, eventType, amountMinor, eventIndex } = input;
  const { deps, eventId, payNoteDocumentId } = context;

  const holdId = buildChargeHoldId({
    payNoteDocumentId,
    eventId,
    eventIndex,
  });

  try {
    await deps.bankingFacade.reserveFunds({
      holdId,
      payerAccountNumber: accounts.payerAccountNumber,
      amountMinor,
      counterpartyAccountNumber: accounts.payeeAccountNumber,
      userId: accounts.payerAccount.ownerUserId,
      idempotencyKey: buildChargeReserveIdempotencyKey({
        eventId,
        eventIndex,
      }),
      payNoteDocumentId,
    });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to reserve funds for card charge request.',
    };
  }

  if (resolveChargeMode(eventType) === 'authorize-only') {
    return { ok: true, holdId };
  }

  try {
    const capturedHold = await deps.bankingFacade.captureHold({
      holdId,
      userId: accounts.payerAccount.ownerUserId,
      idempotencyKey: buildChargeCaptureIdempotencyKey({
        eventId,
        eventIndex,
      }),
      counterpartyAccountNumber: accounts.payeeAccountNumber,
      payNoteDocumentId,
    });

    return {
      ok: true,
      holdId: capturedHold.holdId ?? holdId,
      transactionId: getString(capturedHold.relatedTransactionId),
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to capture card charge request.',
    };
  }
};

const resolveBootstrapFailureReason = (input: {
  status: number;
  body?: unknown;
}): string => {
  const bodyRecord = toSimpleRecord(input.body);
  const detail =
    getString(bodyRecord?.detail) ??
    getString(bodyRecord?.message) ??
    getString(bodyRecord?.error);
  return detail
    ? `Linked PayNote startup failed: ${detail}`
    : `Linked PayNote startup failed with status ${input.status}.`;
};

const resolveLinkedPayNoteChannelBindings = (input: {
  sourceDocument?: unknown;
  guarantorAccountId: string;
}):
  | {
      ok: true;
      channelBindings: Record<string, { accountId: string }>;
    }
  | { ok: false; reason: string } => {
  const sourceDocumentRecord = toSimpleRecord(input.sourceDocument);
  const contracts = toSimpleRecord(sourceDocumentRecord?.contracts);
  if (!contracts) {
    return {
      ok: false,
      reason:
        'Linked PayNote startup requires source contract channels in document payload.',
    };
  }

  const bindings = buildChannelBindingsFromContracts(contracts);
  const payerAccountId = getString(bindings.payerChannel?.accountId);
  const payeeAccountId = getString(bindings.payeeChannel?.accountId);
  if (!payerAccountId || !payeeAccountId) {
    return {
      ok: false,
      reason:
        'Linked PayNote startup requires payerChannel and payeeChannel account bindings.',
    };
  }

  return {
    ok: true,
    channelBindings: {
      payerChannel: { accountId: payerAccountId },
      payeeChannel: { accountId: payeeAccountId },
      guarantorChannel: { accountId: input.guarantorAccountId },
    },
  };
};

const maybeResolveBootstrappedDocumentId = async (input: {
  context: ChargeRequestContext;
  bootstrapSessionId: string;
}): Promise<string | undefined> => {
  const documentResult = await input.context.deps.myOsClient.fetchDocument(
    input.bootstrapSessionId
  );
  if (documentResult.kind !== 'success') {
    return undefined;
  }

  return getString(documentResult.document.documentId);
};

const maybeStartLinkedPayNote = async (input: {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  requestId?: string;
  payNoteDocument: Record<string, unknown>;
  holdId: string;
  transactionId?: string;
  payerAccountNumber: string;
  payeeAccountNumber?: string;
}): Promise<void> => {
  const { context, eventType, requestId } = input;
  const credentials = await resolveCredentials({
    deps: context.deps,
    logs: context.logs,
    eventId: context.eventId,
    payNoteDocumentId: context.payNoteDocumentId,
    sessionId: context.sessionId,
  });

  if (!credentials) {
    await emitLinkedPayNoteStartResponded({
      context,
      eventType,
      requestId,
      status: 'rejected',
      reason: 'Missing MyOS credentials.',
    });
    return;
  }

  const bindingsResult = resolveLinkedPayNoteChannelBindings({
    sourceDocument:
      context.eventObject?.document ?? context.updatedRecord.document,
    guarantorAccountId: credentials.accountId,
  });

  if (!bindingsResult.ok) {
    await emitLinkedPayNoteStartResponded({
      context,
      eventType,
      requestId,
      status: 'rejected',
      reason: bindingsResult.reason,
    });
    return;
  }

  await emitLinkedPayNoteStartResponded({
    context,
    eventType,
    requestId,
    status: 'accepted',
  });

  const response = await context.deps.myOsClient.bootstrapDocument({
    credentials,
    payload: {
      channelBindings: bindingsResult.channelBindings,
      document: input.payNoteDocument,
    },
  });

  if (!response.ok) {
    await emitLinkedPayNoteStartFailed({
      context,
      eventType,
      requestId,
      reason: resolveBootstrapFailureReason({
        status: response.status,
        body: response.body,
      }),
    });
    return;
  }

  const bootstrapSessionId = getString(
    toSimpleRecord(response.body)?.sessionId
  );
  if (!bootstrapSessionId) {
    await emitLinkedPayNoteStartFailed({
      context,
      eventType,
      requestId,
      reason: 'Linked PayNote startup did not return bootstrap session id.',
    });
    return;
  }

  await context.deps.bootstrapContextRepository.saveContext({
    bootstrapSessionId,
    ...(getString(
      context.deliveryRecord?.merchantId ?? context.updatedRecord.merchantId
    )
      ? {
          merchantId: getString(
            context.deliveryRecord?.merchantId ??
              context.updatedRecord.merchantId
          ),
        }
      : {}),
    ...(getString(
      context.deliveryRecord?.accountNumber ??
        context.updatedRecord.accountNumber
    )
      ? {
          accountNumber: getString(
            context.deliveryRecord?.accountNumber ??
              context.updatedRecord.accountNumber
          ),
        }
      : {}),
    ...(getString(
      context.deliveryRecord?.userId ?? context.updatedRecord.userId
    )
      ? {
          userId: getString(
            context.deliveryRecord?.userId ?? context.updatedRecord.userId
          ),
        }
      : {}),
    holdId: input.holdId,
    ...(input.transactionId ? { transactionId: input.transactionId } : {}),
    payerAccountNumber: input.payerAccountNumber,
    ...(input.payeeAccountNumber
      ? { payeeAccountNumber: input.payeeAccountNumber }
      : {}),
    createdAt: context.deps.clock.now().toISOString(),
  });

  const payNoteDocumentId = await maybeResolveBootstrappedDocumentId({
    context,
    bootstrapSessionId,
  });

  await emitLinkedPayNoteStarted({
    context,
    eventType,
    requestId,
    payNoteSessionId: bootstrapSessionId,
    payNoteDocumentId,
  });
};

export const handleChargeRequestEvents = async (input: {
  events: DispatchedTransferEvent[];
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  eventObject?: WebhookEventObject;
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
    updatedRecord,
    deliveryRecord,
    deps,
    logs,
  } = input;

  const context: ChargeRequestContext = {
    eventId,
    payNoteDocumentId,
    sessionId,
    eventObject,
    updatedRecord,
    deliveryRecord,
    deps,
    logs,
  };

  const sourcePayNoteType = resolveSourcePayNoteType(
    eventObject?.document ?? updatedRecord.document
  );

  for (const item of events) {
    const eventType = item.eventType;
    if (!isChargeRequestEventType(eventType)) {
      continue;
    }

    const dedupeKey = buildChargeRequestDedupeKey({
      eventId,
      eventIndex: item.eventIndex,
    });
    const firstProcess = await deps.payNoteRepository.markEventProcessed(
      dedupeKey
    );
    if (!firstProcess) {
      logs.push({
        level: 'info',
        message: 'Skipped duplicate card charge request event',
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
          eventType,
          dedupeKey,
        },
      });
      continue;
    }

    const request = parseChargeRequest(item.event, eventType);
    if (!request) {
      await emitCardChargeResponded({
        context,
        eventType,
        status: 'rejected',
        reason: 'Invalid card charge request payload.',
      });
      continue;
    }

    const requestId = request.requestId;
    const supportsEvent =
      CHARGE_CAPABILITY_MATRIX[sourcePayNoteType]?.has(eventType) ?? false;
    if (!supportsEvent) {
      await emitCardChargeResponded({
        context,
        eventType,
        requestId,
        status: 'rejected',
        reason:
          'Card charge request is not supported for this source PayNote type.',
      });
      continue;
    }

    if (!hasCardTransactionChainContext(context)) {
      await emitCardChargeResponded({
        context,
        eventType,
        requestId,
        status: 'rejected',
        reason:
          'Card charge request requires PayNote rooted in a card transaction chain.',
      });
      continue;
    }

    const direction = resolveChargeDirection(eventType);
    logs.push({
      level: 'info',
      message: 'Card charge request received from PayNote event',
      context: {
        eventId,
        payNoteDocumentId,
        sessionId,
        eventIndex: item.eventIndex,
        eventType,
        requestId: requestId ?? null,
        amountMinor: request.amountMinor,
        direction,
        mode: resolveChargeMode(eventType),
        sourcePayNoteType,
        paymentMandateDocumentId: request.paymentMandateDocumentId ?? null,
      },
    });

    const mandateValidation = await validatePaymentMandate({
      context,
      request,
    });
    if (!mandateValidation.ok) {
      await emitCardChargeResponded({
        context,
        eventType,
        requestId,
        status: 'rejected',
        reason: mandateValidation.reason,
      });
      if (request.payNoteDocument) {
        await emitLinkedPayNoteStartResponded({
          context,
          eventType,
          requestId,
          status: 'rejected',
          reason:
            'Linked PayNote start rejected because payment mandate validation failed.',
        });
      }
      continue;
    }

    const accounts = await resolveChargeAccounts({
      context,
      sourcePayNoteType,
      direction,
    });
    if (!accounts) {
      await emitCardChargeResponded({
        context,
        eventType,
        requestId,
        status: 'rejected',
        reason: 'Unable to resolve payer/payee account mapping.',
      });
      if (request.payNoteDocument) {
        await emitLinkedPayNoteStartResponded({
          context,
          eventType,
          requestId,
          status: 'rejected',
          reason:
            'Linked PayNote start requires successful card charge account resolution.',
        });
      }
      continue;
    }

    await emitCardChargeResponded({
      context,
      eventType,
      requestId,
      status: 'accepted',
    });

    const chargeResult = await executeCardCharge({
      context,
      accounts,
      eventType,
      amountMinor: request.amountMinor,
      eventIndex: item.eventIndex,
    });
    if (!chargeResult.ok) {
      await emitCardChargeCompleted({
        context,
        eventType,
        requestId,
        status: 'failed',
        reason: chargeResult.reason,
      });
      if (request.payNoteDocument) {
        await emitLinkedPayNoteStartResponded({
          context,
          eventType,
          requestId,
          status: 'rejected',
          reason:
            'Linked PayNote start rejected because card charge did not complete.',
        });
      }
      continue;
    }

    await emitCardChargeCompleted({
      context,
      eventType,
      requestId,
      status: 'succeeded',
      holdId: chargeResult.holdId,
      transactionId: chargeResult.transactionId,
    });

    if (!request.payNoteDocument) {
      continue;
    }

    await maybeStartLinkedPayNote({
      context,
      eventType,
      requestId,
      payNoteDocument: request.payNoteDocument,
      holdId: chargeResult.holdId,
      transactionId: chargeResult.transactionId,
      payerAccountNumber: accounts.payerAccountNumber,
      payeeAccountNumber: accounts.payeeAccountNumber,
    });
  }

  return null;
};
