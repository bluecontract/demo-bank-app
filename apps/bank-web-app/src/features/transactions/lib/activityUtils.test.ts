import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '../hooks/useActivity';
import {
  collapseActivityLifecycle,
  filterActivityByCardGroups,
} from './activityUtils';

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

describe('collapseActivityLifecycle', () => {
  it('keeps hold lifecycle history and hides mirrored posted settlement rows', () => {
    const holdCreated = buildHoldCreated({
      activityId: 'HOLD#hold-10',
      holdId: 'hold-10',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    const holdCaptured: ActivityItem = {
      kind: 'HOLD_CAPTURED',
      activityId: 'HOLD#hold-10',
      holdId: 'hold-10',
      amountMinor: 1200,
      capturedAt: '2024-01-01T00:00:02.000Z',
      transactionId: 'txn-10',
      counterpartyAccountNumber: '1234567890',
    };
    const posted = buildPostedTransaction({
      activityId: 'TXN#txn-10',
      transactionId: 'txn-10',
      originHoldId: 'hold-10',
      postedAt: '2024-01-01T00:00:03.000Z',
    });

    const result = collapseActivityLifecycle([
      posted,
      holdCaptured,
      holdCreated,
    ]);

    expect(result).toHaveLength(2);
    expect(result.map(item => item.kind)).toEqual([
      'HOLD_CAPTURED',
      'HOLD_CREATED',
    ]);
  });

  it('keeps unrelated transfers as separate entries', () => {
    const first = buildPostedTransaction({
      activityId: 'TXN#txn-1',
      transactionId: 'txn-1',
      originHoldId: undefined,
      processorChargeId: undefined,
    });
    const second = buildPostedTransaction({
      activityId: 'TXN#txn-2',
      transactionId: 'txn-2',
      originHoldId: undefined,
      processorChargeId: undefined,
      postedAt: '2024-01-01T00:00:10.000Z',
    });

    const result = collapseActivityLifecycle([second, first]);

    expect(result).toEqual([second, first]);
  });
});
