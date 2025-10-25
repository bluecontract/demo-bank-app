import { describe, expect, it, vi } from 'vitest';
import { getIdempotencyKeyHash } from '../idempotency';
import { buildHoldIdempotencyItem } from './idempotency';

describe('Hold idempotency item builder', () => {
  it('should build hold idempotency items with explicit timestamps', () => {
    const item = buildHoldIdempotencyItem({
      userId: 'user-123',
      idempotencyKey: 'reserve-key',
      holdId: 'hold-456',
      command: 'RESERVE',
      createdAt: '2024-01-01T00:00:00.000Z',
      ttl: 1_700_000_000,
      transactionId: 'txn-123',
    });

    expect(item).toEqual({
      PK: 'USER#user-123',
      SK: `IDEMPOTENCY#HOLD#${getIdempotencyKeyHash('reserve-key')}`,
      holdId: 'hold-456',
      command: 'RESERVE',
      createdAt: '2024-01-01T00:00:00.000Z',
      ttl: 1_700_000_000,
      transactionId: 'txn-123',
    });
  });

  it('should default createdAt and ttl', () => {
    vi.useFakeTimers();
    const frozen = new Date('2024-01-01T00:00:00.000Z');
    vi.setSystemTime(frozen);

    try {
      const item = buildHoldIdempotencyItem({
        userId: 'user-123',
        idempotencyKey: 'release-key',
        holdId: 'hold-456',
        command: 'RELEASE',
      });

      expect(item.createdAt).toBe(frozen.toISOString());
      expect(item.ttl).toBe(Math.floor(frozen.getTime() / 1000) + 24 * 60 * 60);
    } finally {
      vi.useRealTimers();
    }
  });
});
