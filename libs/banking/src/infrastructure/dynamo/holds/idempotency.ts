import {
  getIdempotencyKeyHash,
  IDEMPOTENCY_SORT_KEY_PREFIX,
} from '../idempotency';

const USER_PARTITION_KEY_PREFIX = 'USER#';
const HOLD_IDEMPOTENCY_SORT_KEY_PREFIX = `${IDEMPOTENCY_SORT_KEY_PREFIX}HOLD#`;
const HOLD_IDEMPOTENCY_COMMAND_SEPARATOR = '#';

export type HoldIdempotencyCommand =
  | 'RESERVE'
  | 'CAPTURE'
  | 'CAPTURE_PARTIAL'
  | 'RELEASE'
  | 'RELEASE_PARTIAL';

export interface HoldIdempotencyItem {
  PK: string;
  SK: string;
  holdId: string;
  command: HoldIdempotencyCommand;
  createdAt: string;
  ttl: number;
  transactionId?: string;
}

export interface HoldIdempotencyItemInput {
  userId: string;
  idempotencyKey: string;
  holdId: string;
  command: HoldIdempotencyCommand;
  createdAt?: string;
  ttl?: number;
  transactionId?: string;
}

export function buildHoldIdempotencyItem(
  input: HoldIdempotencyItemInput
): HoldIdempotencyItem {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const ttl = input.ttl ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const sortKey = buildHoldIdempotencySortKey(
    input.command,
    input.idempotencyKey
  );
  return {
    PK: `${USER_PARTITION_KEY_PREFIX}${input.userId}`,
    SK: sortKey,
    holdId: input.holdId,
    command: input.command,
    createdAt,
    ttl,
    transactionId: input.transactionId,
  };
}

export function buildHoldIdempotencySortKey(
  command: HoldIdempotencyCommand,
  idempotencyKey: string
): string {
  return `${HOLD_IDEMPOTENCY_SORT_KEY_PREFIX}${command}${HOLD_IDEMPOTENCY_COMMAND_SEPARATOR}${getIdempotencyKeyHash(
    idempotencyKey
  )}`;
}

export function buildLegacyHoldIdempotencySortKey(
  idempotencyKey: string
): string {
  return `${HOLD_IDEMPOTENCY_SORT_KEY_PREFIX}${getIdempotencyKeyHash(
    idempotencyKey
  )}`;
}

export const HOLD_IDEMPOTENCY_CONSTANTS = {
  USER_PARTITION_KEY_PREFIX,
  SORT_KEY_PREFIX: HOLD_IDEMPOTENCY_SORT_KEY_PREFIX,
  COMMAND_SEPARATOR: HOLD_IDEMPOTENCY_COMMAND_SEPARATOR,
} as const;
