import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '../hooks/useActivity';
import { filterActivityByCardGroups } from './activityUtils';

const buildPostedTransaction = (
  overrides: Partial<Extract<ActivityItem, { kind: 'POSTED_TRANSACTION' }>> = {}
) =>
  ({
    kind: 'POSTED_TRANSACTION',
    activityId: 'TXN#txn-1',
    transactionId: 'txn-1',
    amountMinor: 1200,
    description: 'Test',
    postedAt: '2024-01-01T00:00:00.000Z',
    originHoldId: 'hold-1',
    side: 'DEBIT',
    type: 'TRANSFER',
    status: 'POSTED',
    counterpartyAccountNumber: '1234567890',
    cardId: 'card-1',
    cardLast4: '4242',
    processorChargeId: 'ch-1',
    ...overrides,
  } satisfies ActivityItem);

const buildHoldCreated = (
  overrides: Partial<Extract<ActivityItem, { kind: 'HOLD_CREATED' }>> = {}
) =>
  ({
    kind: 'HOLD_CREATED',
    activityId: 'HOLD#hold-1',
    holdId: 'hold-1',
    amountMinor: 1200,
    description: 'Hold',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } satisfies ActivityItem);

describe('filterActivityByCardGroups', () => {
  it('keeps holds linked by origin hold id for card activity', () => {
    const posted = buildPostedTransaction({ originHoldId: 'hold-1' });
    const relatedHold = buildHoldCreated({
      activityId: 'HOLD#hold-1',
      holdId: 'hold-1',
    });
    const unrelatedHold = buildHoldCreated({
      activityId: 'HOLD#hold-2',
      holdId: 'hold-2',
    });

    const result = filterActivityByCardGroups(
      [posted, relatedHold, unrelatedHold],
      (item: ActivityItem) =>
        item.kind === 'POSTED_TRANSACTION' && item.cardId === 'card-1'
    );

    expect(result).toEqual([posted, relatedHold]);
  });

  it('includes activity grouped by processor charge id', () => {
    const posted = buildPostedTransaction({ originHoldId: undefined });
    const relatedHold = buildHoldCreated({
      activityId: 'HOLD#hold-3',
      holdId: 'hold-3',
      processorChargeId: 'ch-1',
    });

    const result = filterActivityByCardGroups(
      [relatedHold, posted],
      (item: ActivityItem) =>
        item.kind === 'POSTED_TRANSACTION' && item.cardId === 'card-1'
    );

    expect(result).toEqual([relatedHold, posted]);
  });
});
