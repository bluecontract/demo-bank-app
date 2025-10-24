export function hashIdempotencyKey(idempotencyKey: string): string {
  return Buffer.from(idempotencyKey)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '');
}
