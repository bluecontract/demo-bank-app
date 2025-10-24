import { randomUUID } from 'crypto';
import type {
  Hold,
  HoldEvent,
  HoldStatus,
  HoldFailedCode,
} from '../../../domain/entities/Hold';

const HOLD_TABLE_PREFIXES = {
  HOLD: 'HOLD#',
  ACCOUNT: 'ACCOUNT#',
} as const;

const HOLD_SORT_KEYS = {
  META: 'META',
} as const;

const HOLD_EVENT_SORT_KEY_PREFIX = 'EVENT#';

const HOLD_GSI1_KEYS = {
  PK: 'HOLD_GSI1PK',
  SK: 'HOLD_GSI1SK',
} as const;

const HOLD_GSI_NAMES = {
  HOLD_GSI1: 'HOLD_GSI1',
} as const;

export interface HoldMetaItem {
  PK: string;
  SK: typeof HOLD_SORT_KEYS.META;
  HOLD_GSI1PK: string;
  HOLD_GSI1SK: string;
  holdId: string;
  payerAccountNumber: string;
  counterpartyAccountNumber?: string;
  amountMinor: number;
  currency: Hold['currency'];
  status: HoldStatus;
  description?: string;
  createdAt: string;
  expiresAt?: string;
  relatedTransactionId?: string;
  releasedAt?: string;
  releaseReason?: string;
}

export interface HoldEventItem {
  PK: string;
  SK: string;
  holdId: string;
  eventId: string;
  at: string;
  type: HoldEvent['type'];
  payload?: Record<string, unknown>;
}

export function buildHoldPartitionKey(holdId: Hold['holdId']): string {
  return `${HOLD_TABLE_PREFIXES.HOLD}${holdId}`;
}

export function buildHoldMetaItem(hold: Hold): HoldMetaItem {
  return {
    PK: buildHoldPartitionKey(hold.holdId),
    SK: HOLD_SORT_KEYS.META,
    HOLD_GSI1PK: `${HOLD_TABLE_PREFIXES.ACCOUNT}${hold.payerAccountNumber}`,
    HOLD_GSI1SK: buildHoldGsiSortKey(hold),
    holdId: hold.holdId,
    payerAccountNumber: hold.payerAccountNumber,
    counterpartyAccountNumber: hold.counterpartyAccountNumber,
    amountMinor: hold.amountMinor,
    currency: hold.currency,
    status: hold.status,
    description: hold.description,
    createdAt: hold.createdAt,
    expiresAt: hold.expiresAt,
    relatedTransactionId: hold.relatedTransactionId,
    releasedAt: hold.releasedAt,
    releaseReason: hold.releaseReason,
  };
}

export function mapHoldMetaItemToHold(item: HoldMetaItem): Hold {
  return {
    holdId: item.holdId,
    payerAccountNumber: item.payerAccountNumber,
    counterpartyAccountNumber: item.counterpartyAccountNumber,
    amountMinor: item.amountMinor,
    currency: item.currency,
    status: item.status,
    description: item.description,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    relatedTransactionId: item.relatedTransactionId,
    releasedAt: item.releasedAt,
    releaseReason: item.releaseReason,
  };
}

function buildHoldGsiSortKey(hold: Hold): string {
  return `${hold.status}#${hold.createdAt}#${hold.holdId}`;
}

export function buildHoldEventSortKey(at: string, eventId: string): string {
  return `${HOLD_EVENT_SORT_KEY_PREFIX}${at}#${eventId}`;
}

export function buildHoldEventItem(
  holdId: Hold['holdId'],
  event: HoldEvent,
  options?: { eventId?: string }
): HoldEventItem {
  const eventId = options?.eventId ?? randomUUID();
  return {
    PK: buildHoldPartitionKey(holdId),
    SK: buildHoldEventSortKey(event.at, eventId),
    holdId,
    eventId,
    at: event.at,
    type: event.type,
    payload: holdEventPayload(event),
  };
}

export function mapHoldEventItemToHoldEvent(item: HoldEventItem): HoldEvent {
  return parseHoldEvent(item);
}

export function parseHoldEventSortKey(sortKey: string): {
  at: string;
  eventId: string;
} {
  if (!sortKey.startsWith(HOLD_EVENT_SORT_KEY_PREFIX)) {
    throw new Error(`Invalid hold event sort key: ${sortKey}`);
  }
  const [, remainder] = sortKey.split(HOLD_EVENT_SORT_KEY_PREFIX);
  if (!remainder) {
    throw new Error(`Unable to parse hold event sort key: ${sortKey}`);
  }
  const [at, eventId] = remainder.split('#');
  if (!at || !eventId) {
    throw new Error(`Unable to parse hold event sort key: ${sortKey}`);
  }
  return { at, eventId };
}

export const HOLD_ITEM_CONSTANTS = {
  TABLE_PREFIXES: HOLD_TABLE_PREFIXES,
  SORT_KEYS: {
    META: HOLD_SORT_KEYS.META,
    EVENT_PREFIX: HOLD_EVENT_SORT_KEY_PREFIX,
  },
  GSI1_KEYS: HOLD_GSI1_KEYS,
  GSI_NAMES: HOLD_GSI_NAMES,
} as const;

function holdEventPayload(
  event: HoldEvent
): Record<string, unknown> | undefined {
  switch (event.type) {
    case 'CREATED':
      return compactRecord({
        createdByUserId: event.createdByUserId,
        idempotencyKeyHash: event.idempotencyKeyHash,
      });
    case 'CAPTURED':
      return {
        transactionId: event.transactionId,
        counterpartyAccountNumber: event.counterpartyAccountNumber,
      };
    case 'RELEASED':
      return compactRecord({
        reason: event.reason,
      });
    case 'FAILED':
      return compactRecord({
        code: event.code,
        message: event.message,
      });
    default:
      return undefined;
  }
}

function parseHoldEvent(item: HoldEventItem): HoldEvent {
  const payload = item.payload ?? {};
  switch (item.type) {
    case 'CREATED':
      return {
        at: item.at,
        type: 'CREATED',
        createdByUserId: extractOptionalString(payload, 'createdByUserId'),
        idempotencyKeyHash: extractOptionalString(
          payload,
          'idempotencyKeyHash'
        ),
      };
    case 'CAPTURED': {
      const transactionId = extractRequiredString(
        payload,
        'transactionId',
        item
      );
      const counterpartyAccountNumber = extractRequiredString(
        payload,
        'counterpartyAccountNumber',
        item
      );
      return {
        at: item.at,
        type: 'CAPTURED',
        transactionId,
        counterpartyAccountNumber,
      };
    }
    case 'RELEASED':
      return {
        at: item.at,
        type: 'RELEASED',
        reason: extractOptionalString(payload, 'reason'),
      };
    case 'FAILED':
      return {
        at: item.at,
        type: 'FAILED',
        code: extractRequiredFailedCode(payload, item),
        message: extractOptionalString(payload, 'message'),
      };
  }
}

function compactRecord(
  record: Record<string, unknown>
): Record<string, unknown> | undefined {
  const entries = Object.entries(record).filter(
    ([, value]) => value !== undefined
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function extractOptionalString(
  payload: Record<string, unknown>,
  key: string
): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function extractRequiredString(
  payload: Record<string, unknown>,
  key: string,
  item: HoldEventItem
): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Hold event item missing required field "${key}" for type ${item.type}`
    );
  }
  return value;
}

function extractRequiredFailedCode(
  payload: Record<string, unknown>,
  item: HoldEventItem
): HoldFailedCode {
  const value = extractRequiredString(payload, 'code', item);
  const allowed: HoldFailedCode[] = [
    'INSUFFICIENT_FUNDS',
    'STATE_MISMATCH',
    'VALIDATION',
    'INTERNAL',
  ];
  if (!allowed.includes(value as HoldFailedCode)) {
    throw new Error(`Invalid hold failed code: ${value}`);
  }
  return value as HoldFailedCode;
}
