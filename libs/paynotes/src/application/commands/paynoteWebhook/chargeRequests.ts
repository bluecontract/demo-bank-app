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
import { upsertPayNoteContract } from './records';
import { trace } from './logging';

const CARD_CHARGE_RESPONDED_EVENT_NAME = 'PayNote/Card Charge Responded';
const CARD_CHARGE_COMPLETED_EVENT_NAME = 'PayNote/Card Charge Completed';
const LINKED_PAYNOTE_START_RESPONDED_EVENT_NAME =
  'PayNote/Linked PayNote Start Responded';
const LINKED_PAYNOTE_STARTED_EVENT_NAME = 'PayNote/Linked PayNote Started';
const LINKED_PAYNOTE_START_FAILED_EVENT_NAME =
  'PayNote/Linked PayNote Start Failed';
const CHARGE_MANDATE_PENDING_ACTION_TYPE = 'chargeMandateApproval';
const CHARGE_MANDATE_PENDING_REASON = 'Awaiting payment mandate approval.';

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

type ChargeMandatePendingActionPayload = {
  source: 'card-charge-request';
  eventId: string;
  eventIndex: number;
  eventType: ChargeRequestEventType;
  payNoteDocumentId: string;
  amountMinor: number;
  direction: ChargeDirection;
  mode: ChargeMode;
  sourcePayNoteType: SourcePayNoteType;
  mandateFailureReason: string;
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
const MANDATE_AUTHORIZE_OPERATION = 'authorizeSpend';
const MANDATE_SETTLE_OPERATION = 'settleSpend';
const MANDATE_SPEND_AUTHORIZATION_REQUESTED_EVENT_NAME =
  'PayNote/Mandate Spend Authorization Requested';
const MANDATE_SPEND_SETTLED_EVENT_NAME = 'PayNote/Mandate Spend Settled';
const MANDATE_POLL_ATTEMPTS = 5;
const MANDATE_POLL_INTERVAL_MS = 75;

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

const formatAmountMinorUsd = (amountMinor: number): string =>
  (amountMinor / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

const buildChargeRequestDedupeKey = (input: {
  eventId: string;
  eventIndex: number;
}) => `paynote-card-charge-request:${input.eventId}:${input.eventIndex}`;

const buildChargeMandatePendingActionId = (input: {
  eventId: string;
  eventIndex: number;
}) => `card-charge-mandate:${input.eventId}:${input.eventIndex}`;

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

const buildChargeAttemptId = (input: {
  payNoteDocumentId: string;
  eventId: string;
  eventIndex: number;
}) =>
  [
    'paynote-card-charge-attempt',
    input.payNoteDocumentId,
    input.eventId,
    String(input.eventIndex),
  ].join(':');

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
  amountReserved?: unknown;
  amountCaptured?: unknown;
  currency?: unknown;
  sourceAccount?: unknown;
  allowLinkedPayNote?: unknown;
  granteeType?: unknown;
  granteeId?: unknown;
  granterType?: unknown;
  granterId?: unknown;
  expiresAt?: unknown;
  revokedAt?: unknown;
  allowedPayNotes?: unknown;
  allowedPaymentCounterparties?: unknown;
  chargeAttempts?: unknown;
};

type ParsedMandateCounterparty = {
  counterpartyType?: string;
  counterpartyId?: string;
};

type ParsedMandateChargeAttempt = {
  authorizationStatus?: string;
  authorizationReason?: string;
  settled?: boolean;
  lastSettlementProcessingStatus?: string;
  settlementReason?: string;
};

type ParsedPaymentMandate = {
  amountLimit?: number;
  amountReserved?: number;
  amountCaptured?: number;
  currency?: string;
  sourceAccount?: string;
  allowLinkedPayNote?: boolean;
  granteeType?: string;
  granteeId?: string;
  granterType?: string;
  granterId?: string;
  expiresAt?: string;
  revokedAt?: string;
  allowedPaymentCounterparties?: ParsedMandateCounterparty[];
  allowedPayNotes?: Array<{
    typeBlueId?: string;
    documentBlueId?: string;
  }>;
  chargeAttempts?: Record<string, ParsedMandateChargeAttempt>;
};

type AcceptedChargeMandatePendingActionPayload = {
  paymentMandateDocumentId?: string;
  paymentMandateSessionId?: string;
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

const parseAllowedPayNotes = (
  value: unknown
): Array<{ typeBlueId?: string; documentBlueId?: string }> | undefined =>
  Array.isArray(value)
    ? value.reduce<Array<{ typeBlueId?: string; documentBlueId?: string }>>(
        (acc, item) => {
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
        },
        []
      )
    : undefined;

const parseAllowedPaymentCounterparties = (
  value: unknown
): ParsedMandateCounterparty[] | undefined =>
  Array.isArray(value)
    ? value.reduce<ParsedMandateCounterparty[]>((acc, item) => {
        const record = toSimpleRecord(item);
        if (!record) {
          return acc;
        }
        const counterpartyType = getString(record.counterpartyType);
        const counterpartyId = getString(record.counterpartyId);
        if (!counterpartyType || !counterpartyId) {
          return acc;
        }
        acc.push({ counterpartyType, counterpartyId });
        return acc;
      }, [])
    : undefined;

const parseMandateChargeAttempts = (
  value: unknown
): Record<string, ParsedMandateChargeAttempt> | undefined => {
  const record = toSimpleRecord(value);
  if (!record) {
    return undefined;
  }

  const parsed = Object.entries(record).reduce<
    Record<string, ParsedMandateChargeAttempt>
  >((acc, [chargeAttemptId, attempt]) => {
    const attemptRecord = toSimpleRecord(attempt);
    if (!attemptRecord) {
      return acc;
    }
    acc[chargeAttemptId] = {
      authorizationStatus: getString(attemptRecord.authorizationStatus),
      authorizationReason: getString(attemptRecord.authorizationReason),
      settled:
        typeof attemptRecord.settled === 'boolean'
          ? attemptRecord.settled
          : undefined,
      lastSettlementProcessingStatus: getString(
        attemptRecord.lastSettlementProcessingStatus
      ),
      settlementReason: getString(attemptRecord.settlementReason),
    };
    return acc;
  }, {});

  return Object.keys(parsed).length > 0 ? parsed : {};
};

const parsePaymentMandate = (value: unknown): ParsedPaymentMandate | null => {
  try {
    const node = blue.jsonValueToNode(value);
    const output = blue.nodeToSchemaOutput(
      node,
      PaymentMandateSchema
    ) as PaymentMandateSchemaOutput;

    return {
      amountLimit: toNonNegativeInteger(output.amountLimit),
      amountReserved: toNonNegativeInteger(output.amountReserved),
      amountCaptured: toNonNegativeInteger(output.amountCaptured),
      currency: getString(output.currency),
      sourceAccount: getString(output.sourceAccount),
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
      allowedPaymentCounterparties: parseAllowedPaymentCounterparties(
        output.allowedPaymentCounterparties
      ),
      allowedPayNotes: parseAllowedPayNotes(output.allowedPayNotes),
      chargeAttempts: parseMandateChargeAttempts(output.chargeAttempts),
    };
  } catch {
    return null;
  }
};

const resolveLocalPaymentMandateFromPendingActions = async (input: {
  context: ChargeRequestContext;
  mandateDocumentId: string;
}): Promise<
  { ok: true; mandateSessionId?: string } | { ok: false; reason: string } | null
> => {
  const contract =
    await input.context.deps.contractRepository.getContractBySessionId(
      input.context.sessionId
    );
  if (!contract || contract.sessionId !== input.context.sessionId) {
    return null;
  }

  const matchedAction = (contract.pendingActions ?? []).find(action => {
    if (action.type !== CHARGE_MANDATE_PENDING_ACTION_TYPE) {
      return false;
    }
    if (action.status !== 'accepted') {
      return false;
    }
    const payload = toSimpleRecord(
      action.payload
    ) as AcceptedChargeMandatePendingActionPayload | null;
    return payload?.paymentMandateDocumentId === input.mandateDocumentId;
  });

  if (!matchedAction) {
    return null;
  }

  const payload = toSimpleRecord(
    matchedAction.payload
  ) as AcceptedChargeMandatePendingActionPayload | null;

  return {
    ok: true,
    mandateSessionId: getString(payload?.paymentMandateSessionId),
  };
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

  if (mandate.amountLimit !== undefined) {
    const currentReserved = mandate.amountReserved ?? 0;
    const currentCaptured = mandate.amountCaptured ?? 0;
    const nextUsed = currentReserved + currentCaptured + request.amountMinor;
    if (nextUsed > mandate.amountLimit) {
      return {
        ok: false,
        reason: 'Payment mandate amount limit exceeded.',
      };
    }
  }

  if (mandate.allowedPaymentCounterparties?.length) {
    const merchantId = resolveContextMerchantId(context);
    const customerId = resolveContextCustomerId(context);
    const accountCandidates = new Set(
      [
        getString(context.deliveryRecord?.accountNumber),
        getString(context.updatedRecord.accountNumber),
        getString(context.updatedRecord.payerAccountNumber),
        getString(context.updatedRecord.payeeAccountNumber),
      ].filter((value): value is string => Boolean(value))
    );
    const isAllowed = mandate.allowedPaymentCounterparties.some(item => {
      if (item.counterpartyType === 'merchantId') {
        return item.counterpartyId === merchantId;
      }
      if (item.counterpartyType === 'customerId') {
        return item.counterpartyId === customerId;
      }
      if (item.counterpartyType === 'accountNumber') {
        return Boolean(
          item.counterpartyId && accountCandidates.has(item.counterpartyId)
        );
      }
      return false;
    });
    if (!isAllowed) {
      return {
        ok: false,
        reason:
          'Payment mandate counterparty does not match requesting contract context.',
      };
    }
  }

  if (mandate.sourceAccount && mandate.sourceAccount !== 'root') {
    return {
      ok: false,
      reason:
        'Payment mandate sourceAccount is not supported for card charge requests.',
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

  return { ok: true };
};

const isLinkedPayNoteAutoAcceptAllowed = (input: {
  mandate: ParsedPaymentMandate;
  request: ParsedChargeRequest;
}): boolean => {
  const { mandate, request } = input;
  if (!request.payNoteDocument) {
    return false;
  }
  if (mandate.allowLinkedPayNote !== true) {
    return false;
  }

  const allowedPayNotes = mandate.allowedPayNotes;
  if (!allowedPayNotes || allowedPayNotes.length === 0) {
    return true;
  }

  const requestedTypeBlueId = resolveDocumentTypeBlueId(
    request.payNoteDocument
  );
  if (!requestedTypeBlueId) {
    return false;
  }

  return allowedPayNotes.some(item => item.typeBlueId === requestedTypeBlueId);
};

const hasExplicitLinkedPayNoteAccountMapping = (
  payNoteDocument: Record<string, unknown>
): boolean => {
  try {
    const simple = blue.nodeToJson(
      blue.jsonValueToNode(payNoteDocument),
      'simple'
    ) as Record<string, unknown> | null;

    if (!simple) {
      return false;
    }

    return Boolean(
      getString(simple.accountNumber) ||
        getString(simple.payerAccountNumber) ||
        getString(simple.payeeAccountNumber)
    );
  } catch {
    return false;
  }
};

const validatePaymentMandate = async (input: {
  context: ChargeRequestContext;
  request: ParsedChargeRequest;
}): Promise<
  | {
      ok: true;
      mandateDocumentId: string;
      mandateSessionId?: string;
      mandate: ParsedPaymentMandate;
    }
  | { ok: false; reason: string }
> => {
  const mandateDocumentId = input.request.paymentMandateDocumentId;
  if (!mandateDocumentId) {
    return {
      ok: false,
      reason: 'Missing payment mandate document id.',
    };
  }

  const localMandate = await resolveLocalPaymentMandateFromPendingActions({
    context: input.context,
    mandateDocumentId,
  });
  if (localMandate && !localMandate.ok) {
    return localMandate;
  }

  let mandateSessionId = localMandate?.ok
    ? localMandate.mandateSessionId
    : undefined;
  if (!mandateSessionId) {
    const mandateContract =
      await input.context.deps.contractRepository.getContractByDocumentId(
        mandateDocumentId
      );
    mandateSessionId = getString(mandateContract?.sessionId);
  }

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

  const scopeValidation = validatePaymentMandateScope({
    mandate,
    context: input.context,
    request: input.request,
  });
  if (!scopeValidation.ok) {
    return scopeValidation;
  }

  return {
    ok: true,
    mandateDocumentId,
    mandateSessionId,
    mandate,
  };
};

const waitFor = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
};

type MandateAttemptDecision =
  | { kind: 'approved' }
  | { kind: 'rejected'; reason?: string }
  | { kind: 'pending'; reason?: string };

const resolveMandateAttemptDecision = (input: {
  mandate: ParsedPaymentMandate;
  chargeAttemptId: string;
}): MandateAttemptDecision => {
  const attempt = input.mandate.chargeAttempts?.[input.chargeAttemptId];
  if (!attempt) {
    return { kind: 'pending' };
  }

  if (attempt.authorizationStatus === 'approved') {
    return { kind: 'approved' };
  }

  if (attempt.authorizationStatus === 'rejected') {
    return { kind: 'rejected', reason: attempt.authorizationReason };
  }

  return { kind: 'pending', reason: attempt.authorizationReason };
};

const resolveMandateSettlementState = (input: {
  mandate: ParsedPaymentMandate;
  chargeAttemptId: string;
}): { status: 'accepted' | 'rejected' | 'pending'; reason?: string } => {
  const attempt = input.mandate.chargeAttempts?.[input.chargeAttemptId];
  if (!attempt) {
    return { status: 'pending' };
  }
  if (attempt.lastSettlementProcessingStatus === 'accepted') {
    return { status: 'accepted' };
  }
  if (attempt.lastSettlementProcessingStatus === 'rejected') {
    return {
      status: 'rejected',
      reason: attempt.settlementReason,
    };
  }
  return { status: 'pending', reason: attempt.settlementReason };
};

const resolveMandateCounterparty = async (input: {
  context: ChargeRequestContext;
  direction: ChargeDirection;
  sourcePayNoteType: SourcePayNoteType;
}): Promise<{
  counterpartyType: 'merchantId' | 'customerId' | 'accountNumber';
  counterpartyId: string;
} | null> => {
  const { context, direction, sourcePayNoteType } = input;
  if (direction === 'linked') {
    const merchantId = resolveContextMerchantId(context);
    if (merchantId) {
      return { counterpartyType: 'merchantId', counterpartyId: merchantId };
    }

    const fallbackMerchantAccount = await resolveMerchantFundingAccountNumber({
      context,
      sourcePayNoteType,
    });
    if (fallbackMerchantAccount) {
      return {
        counterpartyType: 'accountNumber',
        counterpartyId: fallbackMerchantAccount,
      };
    }
    return null;
  }

  const customerId = resolveContextCustomerId(context);
  if (customerId) {
    return { counterpartyType: 'customerId', counterpartyId: customerId };
  }

  const fallbackCustomerAccount = resolveRootCustomerAccountNumber(context);
  if (fallbackCustomerAccount) {
    return {
      counterpartyType: 'accountNumber',
      counterpartyId: fallbackCustomerAccount,
    };
  }
  return null;
};

const toMandateChargeMode = (
  mode: ChargeMode
): 'authorize_only' | 'authorize_and_capture' =>
  mode === 'authorize-and-capture' ? 'authorize_and_capture' : 'authorize_only';

const runMandateAuthorization = async (input: {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  eventIndex: number;
  requestId?: string;
  sourcePayNoteType: SourcePayNoteType;
  direction: ChargeDirection;
  mode: ChargeMode;
  amountMinor: number;
  mandateSessionId?: string;
  chargeAttemptId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const {
    context,
    eventType,
    eventIndex,
    requestId,
    sourcePayNoteType,
    direction,
    mode,
    amountMinor,
    mandateSessionId,
    chargeAttemptId,
  } = input;

  if (!mandateSessionId) {
    return {
      ok: false,
      reason: 'Unable to resolve payment mandate session id.',
    };
  }

  const credentials = await resolveCredentials({
    deps: context.deps,
    logs: context.logs,
    eventId: context.eventId,
    payNoteDocumentId: context.payNoteDocumentId,
    sessionId: context.sessionId,
  });
  if (!credentials) {
    return { ok: false, reason: 'Missing MyOS credentials.' };
  }

  const counterparty = await resolveMandateCounterparty({
    context,
    direction,
    sourcePayNoteType,
  });
  if (!counterparty) {
    return {
      ok: false,
      reason:
        'Unable to resolve mandate authorization counterparty for charge request.',
    };
  }

  const authorizePayload = {
    type: MANDATE_SPEND_AUTHORIZATION_REQUESTED_EVENT_NAME,
    chargeAttemptId,
    requestingDocumentId: context.payNoteDocumentId,
    requestingSessionId: context.sessionId,
    amountMinor,
    currency: 'USD',
    requestedAt: context.deps.clock.now().toISOString(),
    counterpartyType: counterparty.counterpartyType,
    counterpartyId: counterparty.counterpartyId,
    chargeMode: toMandateChargeMode(mode),
  };

  const authorizeResponse = await context.deps.myOsClient.runDocumentOperation({
    credentials,
    sessionId: mandateSessionId,
    operation: MANDATE_AUTHORIZE_OPERATION,
    payload: authorizePayload,
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

  let fallbackReason: string | undefined;
  for (
    let attemptIndex = 0;
    attemptIndex < MANDATE_POLL_ATTEMPTS;
    attemptIndex += 1
  ) {
    const fetched = await context.deps.myOsClient.fetchDocument(
      mandateSessionId
    );
    if (fetched.kind === 'success' && fetched.document.document) {
      const parsed = parsePaymentMandate(fetched.document.document);
      if (parsed) {
        const decision = resolveMandateAttemptDecision({
          mandate: parsed,
          chargeAttemptId,
        });
        if (decision.kind === 'approved') {
          return { ok: true };
        }
        if (decision.kind === 'rejected') {
          return {
            ok: false,
            reason:
              decision.reason ??
              'Payment mandate rejected charge authorization.',
          };
        }
        fallbackReason = decision.reason ?? fallbackReason;
      }
    }

    if (attemptIndex < MANDATE_POLL_ATTEMPTS - 1) {
      await waitFor(MANDATE_POLL_INTERVAL_MS);
    }
  }

  context.logs.push({
    level: 'warn',
    message:
      'Payment mandate authorization status was not observed after authorizeSpend; rejecting request',
    context: {
      eventId: context.eventId,
      payNoteDocumentId: context.payNoteDocumentId,
      sessionId: context.sessionId,
      eventType,
      eventIndex,
      requestId: requestId ?? null,
      chargeAttemptId,
      mandateSessionId,
      reason: fallbackReason ?? null,
    },
  });

  return {
    ok: false,
    reason:
      fallbackReason ??
      'Payment mandate authorization status was not confirmed.',
  };
};

type ChargeExecutionSuccess = {
  ok: true;
  holdId: string;
  transactionId?: string;
};

type ChargeExecutionFailure = {
  ok: false;
  reason: string;
  holdId?: string;
  reserveSucceeded: boolean;
};

type MandateSettlementInput = {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  eventIndex: number;
  requestId?: string;
  mandateDocumentId: string;
  mandateSessionId?: string;
  chargeAttemptId: string;
  amountMinor: number;
  mode: ChargeMode;
  chargeResult: ChargeExecutionSuccess | ChargeExecutionFailure;
};

const runMandateSettlement = async (
  input: MandateSettlementInput
): Promise<void> => {
  const {
    context,
    eventType,
    eventIndex,
    requestId,
    mandateDocumentId,
    mandateSessionId,
    chargeAttemptId,
    amountMinor,
    mode,
    chargeResult,
  } = input;

  if (!mandateSessionId) {
    context.logs.push({
      level: 'warn',
      message:
        'Skipping mandate settleSpend operation (missing mandate session id)',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        sessionId: context.sessionId,
        eventType,
        requestId: requestId ?? null,
        mandateDocumentId,
        chargeAttemptId,
      },
    });
    return;
  }

  const credentials = await resolveCredentials({
    deps: context.deps,
    logs: context.logs,
    eventId: context.eventId,
    payNoteDocumentId: context.payNoteDocumentId,
    sessionId: context.sessionId,
  });
  if (!credentials) {
    return;
  }

  const isCaptureMode = mode === 'authorize-and-capture';
  const settlementStatus: 'succeeded' | 'failed' = chargeResult.ok
    ? 'succeeded'
    : 'failed';
  const reserveSucceeded = chargeResult.ok
    ? true
    : chargeResult.reserveSucceeded;
  const reservedDeltaMinor =
    settlementStatus === 'succeeded'
      ? isCaptureMode
        ? -amountMinor
        : 0
      : reserveSucceeded
      ? 0
      : -amountMinor;
  const capturedDeltaMinor =
    settlementStatus === 'succeeded' && isCaptureMode ? amountMinor : 0;

  const settlePayload = {
    type: MANDATE_SPEND_SETTLED_EVENT_NAME,
    chargeAttemptId,
    status: settlementStatus,
    settledAt: context.deps.clock.now().toISOString(),
    reservedDeltaMinor,
    capturedDeltaMinor,
    ...(chargeResult.holdId ? { holdId: chargeResult.holdId } : {}),
    ...(chargeResult.ok && chargeResult.transactionId
      ? { transactionId: chargeResult.transactionId }
      : {}),
    ...(!chargeResult.ok && chargeResult.reason
      ? { reason: chargeResult.reason }
      : {}),
  };

  const settleResponse = await context.deps.myOsClient.runDocumentOperation({
    credentials,
    sessionId: mandateSessionId,
    operation: MANDATE_SETTLE_OPERATION,
    payload: settlePayload,
  });
  if (!settleResponse.ok) {
    context.logs.push({
      level: 'warn',
      message: 'Payment mandate settleSpend request failed',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        sessionId: context.sessionId,
        eventType,
        eventIndex,
        requestId: requestId ?? null,
        mandateDocumentId,
        chargeAttemptId,
        reason: resolveOperationFailureReason({
          status: settleResponse.status,
          body: settleResponse.body,
          fallbackPrefix: 'Payment mandate settleSpend failed',
        }),
      },
    });
    return;
  }

  for (
    let attemptIndex = 0;
    attemptIndex < MANDATE_POLL_ATTEMPTS;
    attemptIndex += 1
  ) {
    const fetched = await context.deps.myOsClient.fetchDocument(
      mandateSessionId
    );
    if (fetched.kind === 'success' && fetched.document.document) {
      const parsed = parsePaymentMandate(fetched.document.document);
      if (parsed) {
        const settlement = resolveMandateSettlementState({
          mandate: parsed,
          chargeAttemptId,
        });
        if (settlement.status === 'accepted') {
          return;
        }
        if (settlement.status === 'rejected') {
          context.logs.push({
            level: 'warn',
            message: 'Payment mandate settlement was rejected',
            context: {
              eventId: context.eventId,
              payNoteDocumentId: context.payNoteDocumentId,
              sessionId: context.sessionId,
              eventType,
              eventIndex,
              requestId: requestId ?? null,
              mandateDocumentId,
              chargeAttemptId,
              reason: settlement.reason ?? null,
            },
          });
          return;
        }
      }
    }

    if (attemptIndex < MANDATE_POLL_ATTEMPTS - 1) {
      await waitFor(MANDATE_POLL_INTERVAL_MS);
    }
  }
};

const queueChargeMandatePendingAction = async (input: {
  context: ChargeRequestContext;
  request: ParsedChargeRequest;
  eventType: ChargeRequestEventType;
  eventIndex: number;
  sourcePayNoteType: SourcePayNoteType;
  direction: ChargeDirection;
  mode: ChargeMode;
  mandateFailureReason: string;
}): Promise<boolean> => {
  const {
    context,
    request,
    eventType,
    eventIndex,
    sourcePayNoteType,
    direction,
    mode,
    mandateFailureReason,
  } = input;

  const contract = await context.deps.contractRepository.getContractBySessionId(
    context.sessionId
  );
  if (!contract || contract.sessionId !== context.sessionId) {
    context.logs.push({
      level: 'warn',
      message:
        'Unable to create charge mandate pending action (unknown canonical contract session)',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        sessionId: context.sessionId,
        eventType,
        eventIndex,
      },
    });
    return false;
  }

  const actionId = buildChargeMandatePendingActionId({
    eventId: context.eventId,
    eventIndex,
  });
  const existingAction = (contract.pendingActions ?? []).find(
    action => action.actionId === actionId
  );
  if (existingAction?.status === 'pending') {
    return true;
  }
  if (existingAction) {
    context.logs.push({
      level: 'warn',
      message:
        'Skipped creating mandate pending action because request already has a final decision',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        sessionId: context.sessionId,
        eventType,
        eventIndex,
        actionId,
        existingStatus: existingAction.status,
      },
    });
    return false;
  }

  const createdAt = context.deps.clock.now().toISOString();
  const payload: ChargeMandatePendingActionPayload = {
    source: 'card-charge-request',
    eventId: context.eventId,
    eventIndex,
    eventType,
    payNoteDocumentId: context.payNoteDocumentId,
    amountMinor: request.amountMinor,
    direction,
    mode,
    sourcePayNoteType,
    mandateFailureReason,
    ...(request.payNoteDocument
      ? { payNoteDocument: request.payNoteDocument }
      : {}),
  };
  const action = {
    actionId,
    type: CHARGE_MANDATE_PENDING_ACTION_TYPE,
    status: 'pending',
    title: 'Approve payment mandate',
    summary: `Approve a ${formatAmountMinorUsd(
      request.amountMinor
    )} card charge request.`,
    ...(request.requestId ? { requestId: request.requestId } : {}),
    payload,
    createdAt,
  } as const;

  const nextActions = (contract.pendingActions ?? []).filter(
    item => item.actionId !== actionId
  );
  nextActions.push(action);

  await context.deps.contractRepository.saveContract({
    ...contract,
    pendingActions: nextActions,
    updatedAt: createdAt,
  });
  await context.deps.contractRepository.addContractHistoryEntry({
    contractId: contract.contractId,
    kind: 'pendingActionRequested',
    short: 'Payment mandate approval requested.',
    more: mandateFailureReason,
    createdAt,
  });

  context.logs.push({
    level: 'info',
    message: 'Card charge request queued as mandate pending action',
    context: {
      eventId: context.eventId,
      payNoteDocumentId: context.payNoteDocumentId,
      sessionId: context.sessionId,
      eventType,
      eventIndex,
      actionId,
      requestId: request.requestId ?? null,
      reason: mandateFailureReason,
    },
  });

  return true;
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
}): Promise<ChargeExecutionSuccess | ChargeExecutionFailure> => {
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
      reserveSucceeded: false,
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
      reserveSucceeded: true,
      holdId,
      reason:
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to capture card charge request.',
    };
  }
};

const persistChargeExecutionArtifacts = async (input: {
  context: ChargeRequestContext;
  eventType: ChargeRequestEventType;
  chargeResult: { holdId: string; transactionId?: string };
}): Promise<void> => {
  const { context, eventType, chargeResult } = input;
  const now = context.deps.clock.now().toISOString();

  context.updatedRecord.holdId = chargeResult.holdId;
  if (chargeResult.transactionId) {
    context.updatedRecord.transactionId = chargeResult.transactionId;
  }
  context.updatedRecord.updatedAt = now;

  await context.deps.payNoteRepository.savePayNote({
    ...context.updatedRecord,
    updatedAt: now,
  });

  await upsertPayNoteContract({
    updatedRecord: context.updatedRecord,
    deliveryRecord: context.deliveryRecord,
    sessionId: context.sessionId,
    payNoteDocumentId: context.payNoteDocumentId,
    eventType,
    eventEpoch: context.eventObject?.epoch,
    triggerEvent: context.eventObject?.triggeredBy,
    emittedEvents: context.eventObject?.emitted,
    relatedHoldIds: [chargeResult.holdId],
    relatedTransactionIds: chargeResult.transactionId
      ? [chargeResult.transactionId]
      : undefined,
    now,
    deps: context.deps,
  });

  trace(context.logs, 'Persisted card charge artifacts for PayNote contract', {
    eventId: context.eventId,
    payNoteDocumentId: context.payNoteDocumentId,
    sessionId: context.sessionId,
    eventType,
    holdId: chargeResult.holdId,
    transactionId: chargeResult.transactionId ?? null,
  });
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

type LinkedPayNoteParticipantBindings = {
  payNoteChannelBindings: Record<string, { accountId: string }>;
  deliveryChannelBindings: Record<string, { accountId: string }>;
};

type CardTransactionDetailsPayload = {
  retrievalReferenceNumber: string;
  systemTraceAuditNumber: string;
  transmissionDateTime: string;
  authorizationCode: string;
};

const resolveLinkedPayNoteBindings = (input: {
  sourceDocument?: unknown;
  guarantorAccountId: string;
}):
  | {
      ok: true;
      bindings: LinkedPayNoteParticipantBindings;
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
  const payNoteSenderAccountId = payeeAccountId;
  if (!payerAccountId || !payeeAccountId) {
    return {
      ok: false,
      reason:
        'Linked PayNote startup requires payerChannel and payeeChannel account bindings.',
    };
  }
  if (!payNoteSenderAccountId) {
    return {
      ok: false,
      reason:
        'Linked PayNote startup requires payNoteSender binding derived from source document.',
    };
  }

  return {
    ok: true,
    bindings: {
      payNoteChannelBindings: {
        payerChannel: { accountId: payerAccountId },
        payeeChannel: { accountId: payeeAccountId },
        guarantorChannel: { accountId: input.guarantorAccountId },
      },
      deliveryChannelBindings: {
        payerChannel: { accountId: payerAccountId },
        payeeChannel: { accountId: payeeAccountId },
        payNoteSender: { accountId: payNoteSenderAccountId },
        payNoteDeliverer: { accountId: input.guarantorAccountId },
      },
    },
  };
};

const resolveCardTransactionDetailsPayload = (
  value: unknown
): CardTransactionDetailsPayload | null => {
  const record = toSimpleRecord(value);
  if (!record) {
    return null;
  }

  const retrievalReferenceNumber = getString(record.retrievalReferenceNumber);
  const systemTraceAuditNumber = getString(record.systemTraceAuditNumber);
  const transmissionDateTime = getString(record.transmissionDateTime);
  const authorizationCode = getString(record.authorizationCode);

  if (
    !retrievalReferenceNumber ||
    !systemTraceAuditNumber ||
    !transmissionDateTime ||
    !authorizationCode
  ) {
    return null;
  }

  return {
    retrievalReferenceNumber,
    systemTraceAuditNumber,
    transmissionDateTime,
    authorizationCode,
  };
};

const resolveLinkedPayNoteCardTransactionDetails = async (input: {
  context: ChargeRequestContext;
}): Promise<CardTransactionDetailsPayload | null> => {
  const fromDelivery = resolveCardTransactionDetailsPayload(
    input.context.deliveryRecord?.cardTransactionDetails
  );
  if (fromDelivery) {
    return fromDelivery;
  }

  const holdId = getString(input.context.updatedRecord.holdId);
  if (!holdId) {
    return null;
  }

  try {
    const hold = await input.context.deps.holdRepository.getHold(holdId);
    return resolveCardTransactionDetailsPayload(hold?.cardTransactionDetails);
  } catch (error) {
    input.context.logs.push({
      level: 'warn',
      message:
        'Linked PayNote startup failed to resolve card transaction details from hold',
      context: {
        eventId: input.context.eventId,
        payNoteDocumentId: input.context.payNoteDocumentId,
        holdId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
};

const buildLinkedPayNoteDeliveryDocument = (input: {
  payNoteDocument: Record<string, unknown>;
  requestId?: string;
  cardTransactionDetails: CardTransactionDetailsPayload;
  payNoteChannelBindings: Record<string, { accountId: string }>;
}) => ({
  type: 'PayNote/PayNote Delivery',
  name: 'Linked PayNote Delivery',
  payNoteBootstrapRequest: {
    type: 'Conversation/Document Bootstrap Requested',
    bootstrapAssignee: 'payNoteDeliverer',
    ...(input.requestId ? { requestId: input.requestId } : {}),
    channelBindings: input.payNoteChannelBindings,
    document: input.payNoteDocument,
  },
  cardTransactionDetails: input.cardTransactionDetails,
  contracts: {
    payNoteSender: {
      type: 'MyOS/MyOS Timeline Channel',
    },
    payNoteDeliverer: {
      type: 'MyOS/MyOS Timeline Channel',
    },
    payerChannel: {
      type: 'MyOS/MyOS Timeline Channel',
    },
    payeeChannel: {
      type: 'MyOS/MyOS Timeline Channel',
    },
  },
});

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

const resolveLinkedPayNoteSessionIdFromAcceptResponse = (
  body: unknown
): string | undefined => {
  const bodyRecord = toSimpleRecord(body);
  const direct =
    getString(bodyRecord?.payNoteSessionId) ??
    getString(bodyRecord?.startedPayNoteSessionId);
  if (direct) {
    return direct;
  }

  const resultRecord = toSimpleRecord(bodyRecord?.result);
  return (
    getString(resultRecord?.payNoteSessionId) ??
    getString(resultRecord?.startedPayNoteSessionId)
  );
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
  autoAcceptLinkedPayNote: boolean;
}): Promise<void> => {
  const { context, eventType, requestId } = input;

  if (hasExplicitLinkedPayNoteAccountMapping(input.payNoteDocument)) {
    await emitLinkedPayNoteStartResponded({
      context,
      eventType,
      requestId,
      status: 'rejected',
      reason:
        'Linked PayNote startup does not allow explicit payer/payee account mapping.',
    });
    return;
  }

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

  const bindingsResult = resolveLinkedPayNoteBindings({
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

  const cardTransactionDetails =
    await resolveLinkedPayNoteCardTransactionDetails({ context });
  if (!cardTransactionDetails) {
    await emitLinkedPayNoteStartResponded({
      context,
      eventType,
      requestId,
      status: 'rejected',
      reason:
        'Linked PayNote startup requires card transaction details from root card transaction context.',
    });
    return;
  }

  const deliveryDocument = buildLinkedPayNoteDeliveryDocument({
    payNoteDocument: input.payNoteDocument,
    requestId,
    cardTransactionDetails,
    payNoteChannelBindings: bindingsResult.bindings.payNoteChannelBindings,
  });

  const response = await context.deps.myOsClient.bootstrapDocument({
    credentials,
    payload: {
      channelBindings: bindingsResult.bindings.deliveryChannelBindings,
      document: deliveryDocument,
    },
  });

  if (!response.ok) {
    await emitLinkedPayNoteStartResponded({
      context,
      eventType,
      requestId,
      status: 'rejected',
      reason: resolveBootstrapFailureReason({
        status: response.status,
        body: response.body,
      }),
    });
    return;
  }

  const deliverySessionId = getString(toSimpleRecord(response.body)?.sessionId);
  if (!deliverySessionId) {
    await emitLinkedPayNoteStartResponded({
      context,
      eventType,
      requestId,
      status: 'rejected',
      reason: 'Linked PayNote delivery startup did not return session id.',
    });
    return;
  }

  const requestingContract =
    await context.deps.contractRepository.getContractBySessionId(
      context.sessionId
    );
  const customerChannelKey = getString(requestingContract?.customerChannelKey);

  await context.deps.bootstrapContextRepository.saveContext({
    bootstrapSessionId: deliverySessionId,
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
    ...(customerChannelKey ? { customerChannelKey } : {}),
    requestingSessionId: context.sessionId,
    ...(requestId ? { requestId } : {}),
    createdAt: context.deps.clock.now().toISOString(),
  });

  await emitLinkedPayNoteStartResponded({
    context,
    eventType,
    requestId,
    status: 'accepted',
  });

  if (!input.autoAcceptLinkedPayNote) {
    context.logs.push({
      level: 'info',
      message:
        'Linked PayNote delivery started without auto-accept (mandate/policy)',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        deliverySessionId,
        requestId: requestId ?? null,
      },
    });
    return;
  }

  const acceptResponse = await context.deps.myOsClient.runDocumentOperation({
    credentials,
    sessionId: deliverySessionId,
    operation: 'acceptPayNote',
    payload: {
      acceptedAt: context.deps.clock.now().toISOString(),
    },
  });

  if (!acceptResponse.ok) {
    await emitLinkedPayNoteStartFailed({
      context,
      eventType,
      requestId,
      reason: resolveOperationFailureReason({
        status: acceptResponse.status,
        body: acceptResponse.body,
        fallbackPrefix: 'Linked PayNote delivery auto-accept failed',
      }),
    });
    return;
  }

  let payNoteSessionId = resolveLinkedPayNoteSessionIdFromAcceptResponse(
    acceptResponse.body
  );
  if (!payNoteSessionId) {
    const resolvedDelivery =
      await context.deps.payNoteDeliveryRepository.getDeliveryBySessionId(
        deliverySessionId
      );
    const latestSessionId = resolvedDelivery?.payNoteSessionIds?.at(-1);
    payNoteSessionId = getString(latestSessionId);
  }

  if (!payNoteSessionId) {
    context.logs.push({
      level: 'info',
      message:
        'Linked PayNote auto-accept completed; waiting for PayNote bootstrap webhook',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        deliverySessionId,
        requestId: requestId ?? null,
      },
    });
    return;
  }

  const payNoteDocumentId = await maybeResolveBootstrappedDocumentId({
    context,
    bootstrapSessionId: payNoteSessionId,
  });

  await emitLinkedPayNoteStarted({
    context,
    eventType,
    requestId,
    payNoteSessionId,
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
    const mode = resolveChargeMode(eventType);
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
        mode,
        sourcePayNoteType,
        paymentMandateDocumentId: request.paymentMandateDocumentId ?? null,
      },
    });

    const mandateValidation = await validatePaymentMandate({
      context,
      request,
    });
    if (!mandateValidation.ok) {
      const queuedPendingAction = await queueChargeMandatePendingAction({
        context,
        request,
        eventType,
        eventIndex: item.eventIndex,
        sourcePayNoteType,
        direction,
        mode,
        mandateFailureReason: mandateValidation.reason,
      });

      if (queuedPendingAction) {
        await emitCardChargeResponded({
          context,
          eventType,
          requestId,
          status: 'pending',
          reason: CHARGE_MANDATE_PENDING_REASON,
        });
      } else {
        await emitCardChargeResponded({
          context,
          eventType,
          requestId,
          status: 'rejected',
          reason: mandateValidation.reason,
        });
      }
      continue;
    }

    const chargeAttemptId = buildChargeAttemptId({
      payNoteDocumentId,
      eventId,
      eventIndex: item.eventIndex,
    });
    const mandateAuthorization = await runMandateAuthorization({
      context,
      eventType,
      eventIndex: item.eventIndex,
      requestId,
      sourcePayNoteType,
      direction,
      mode,
      amountMinor: request.amountMinor,
      mandateSessionId: mandateValidation.mandateSessionId,
      chargeAttemptId,
    });
    if (!mandateAuthorization.ok) {
      await emitCardChargeResponded({
        context,
        eventType,
        requestId,
        status: 'rejected',
        reason: mandateAuthorization.reason,
      });
      if (request.payNoteDocument) {
        await emitLinkedPayNoteStartResponded({
          context,
          eventType,
          requestId,
          status: 'rejected',
          reason:
            'Linked PayNote start rejected because mandate authorization failed.',
        });
      }
      continue;
    }

    const autoAcceptLinkedPayNote = isLinkedPayNoteAutoAcceptAllowed({
      mandate: mandateValidation.mandate,
      request,
    });

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
        holdId: chargeResult.holdId,
        reason: chargeResult.reason,
      });
      await runMandateSettlement({
        context,
        eventType,
        eventIndex: item.eventIndex,
        requestId,
        mandateDocumentId: mandateValidation.mandateDocumentId,
        mandateSessionId: mandateValidation.mandateSessionId,
        chargeAttemptId,
        amountMinor: request.amountMinor,
        mode,
        chargeResult,
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
      if (chargeResult.holdId) {
        await persistChargeExecutionArtifacts({
          context,
          eventType,
          chargeResult: { holdId: chargeResult.holdId },
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
    await runMandateSettlement({
      context,
      eventType,
      eventIndex: item.eventIndex,
      requestId,
      mandateDocumentId: mandateValidation.mandateDocumentId,
      mandateSessionId: mandateValidation.mandateSessionId,
      chargeAttemptId,
      amountMinor: request.amountMinor,
      mode,
      chargeResult,
    });

    if (request.payNoteDocument) {
      await maybeStartLinkedPayNote({
        context,
        eventType,
        requestId,
        payNoteDocument: request.payNoteDocument,
        holdId: chargeResult.holdId,
        transactionId: chargeResult.transactionId,
        payerAccountNumber: accounts.payerAccountNumber,
        payeeAccountNumber: accounts.payeeAccountNumber,
        autoAcceptLinkedPayNote,
      });
    }

    await persistChargeExecutionArtifacts({
      context,
      eventType,
      chargeResult,
    });
  }

  return null;
};
