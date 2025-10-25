import {
  getIdempotencyKeyHash,
  IDEMPOTENCY_SORT_KEY_PREFIX,
} from '../idempotency';

const USER_PARTITION_KEY_PREFIX = 'USER#';
const HOLD_IDEMPOTENCY_SORT_KEY_PREFIX = `${IDEMPOTENCY_SORT_KEY_PREFIX}HOLD#`;

export type HoldIdempotencyCommand = 'RESERVE' | 'CAPTURE' | 'RELEASE';

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
  return {
    PK: `${USER_PARTITION_KEY_PREFIX}${input.userId}`,
    SK: `${HOLD_IDEMPOTENCY_SORT_KEY_PREFIX}${getIdempotencyKeyHash(
      input.idempotencyKey
    )}`,
    holdId: input.holdId,
    command: input.command,
    createdAt,
    ttl,
    transactionId: input.transactionId,
  };
}

export const HOLD_IDEMPOTENCY_CONSTANTS = {
  USER_PARTITION_KEY_PREFIX,
  SORT_KEY_PREFIX: HOLD_IDEMPOTENCY_SORT_KEY_PREFIX,
} as const;
