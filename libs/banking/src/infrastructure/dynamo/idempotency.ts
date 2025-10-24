import { hashIdempotencyKey } from '../../domain/idempotency';

export const IDEMPOTENCY_SORT_KEY_PREFIX = 'IDEMPOTENCY#';

export function getIdempotencyKeyHash(idempotencyKey: string): string {
  return hashIdempotencyKey(idempotencyKey);
}
