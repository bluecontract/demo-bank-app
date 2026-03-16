import { describe, expect, it } from 'vitest';
import {
  resolveActivePendingAction,
  resolveCurrentSummaryEpoch,
} from './pendingActionQueue';

describe('resolveCurrentSummaryEpoch', () => {
  it('returns direct numeric epoch', () => {
    expect(resolveCurrentSummaryEpoch(7)).toBe(7);
  });

  it('falls back to 0 for invalid input', () => {
    expect(resolveCurrentSummaryEpoch(undefined)).toBe(0);
    expect(resolveCurrentSummaryEpoch({ value: 3 })).toBe(0);
  });
});

describe('resolveActivePendingAction', () => {
  it('returns queue head only when summary epoch satisfies minSummaryEpoch', () => {
    const actions = [
      {
        actionId: 'a2',
        status: 'pending',
        queueOrder: 3,
        minSummaryEpoch: 1,
      },
      {
        actionId: 'a1',
        status: 'pending',
        queueOrder: 2,
        minSummaryEpoch: 3,
      },
    ];

    expect(
      resolveActivePendingAction({
        actions,
        currentSummaryEpoch: 2,
      })
    ).toBeNull();

    expect(
      resolveActivePendingAction({
        actions,
        currentSummaryEpoch: 3,
      })?.actionId
    ).toBe('a1');
  });

  it('ignores non-pending actions and uses insertion order fallback', () => {
    const actions = [
      { actionId: 'done', status: 'accepted' },
      { actionId: 'pending-1', status: 'pending' },
      { actionId: 'pending-2', status: 'pending' },
    ];

    expect(
      resolveActivePendingAction({
        actions,
        currentSummaryEpoch: 0,
      })?.actionId
    ).toBe('pending-1');
  });
});
