export const IDEMPOTENCY_SORT_KEY_PREFIX = 'IDEMPOTENCY#';

export function getIdempotencyKeyHash(idempotencyKey: string): string {
  return Buffer.from(idempotencyKey)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '');
}
