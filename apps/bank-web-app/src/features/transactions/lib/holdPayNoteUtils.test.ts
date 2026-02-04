import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '../hooks/useActivity';
import type { ActivityDetail } from '../hooks/useActivityDetail';
import { getHoldTimelinePayNoteDocumentId } from './holdPayNoteUtils';

type HoldDetail = Extract<ActivityDetail, { kind: 'HOLD' }>;

const buildHoldDetail = (
  timeline: HoldDetail['timeline']
): HoldDetail => ({
  kind: 'HOLD',
  activityId: 'HOLD#hold-1',
  holdId: 'hold-1',
  amountMinor: 1200,
  currency: 'USD',
  status: 'PENDING',
  createdAt: '2024-01-01T00:00:00.000Z',
  timeline,
});

const buildHoldCapturedActivity = (
  transactionId: string
): Extract<ActivityItem, { kind: 'HOLD_CAPTURED' }> => ({
  kind: 'HOLD_CAPTURED',
  activityId: 'HOLD#hold-1',
  holdId: 'hold-1',
  amountMinor: 1200,
  capturedAt: '2024-01-02T00:00:00.000Z',
  transactionId,
  counterpartyAccountNumber: '1234567890',
});

describe('getHoldTimelinePayNoteDocumentId', () => {
  it('returns the matching capture paynote id when transaction id matches', () => {
    const holdDetail = buildHoldDetail([
      {
        type: 'CREATED',
        at: '2024-01-01T00:00:00.000Z',
        payNoteDocumentId: 'doc-created',
      },
      {
        type: 'CAPTURED',
        at: '2024-01-02T00:00:00.000Z',
        transactionId: 'txn-1',
        payNoteDocumentId: 'doc-captured',
      },
    ]);

    const selectedActivity = buildHoldCapturedActivity('txn-1');

    expect(
      getHoldTimelinePayNoteDocumentId(holdDetail, selectedActivity)
    ).toBe('doc-captured');
  });

  it('falls back to the created paynote id when capture does not match', () => {
    const holdDetail = buildHoldDetail([
      {
        type: 'CREATED',
        at: '2024-01-01T00:00:00.000Z',
        payNoteDocumentId: 'doc-created',
      },
      {
        type: 'CAPTURED',
        at: '2024-01-02T00:00:00.000Z',
        transactionId: 'txn-1',
        payNoteDocumentId: 'doc-captured',
      },
    ]);

    const selectedActivity = buildHoldCapturedActivity('txn-mismatch');

    expect(
      getHoldTimelinePayNoteDocumentId(holdDetail, selectedActivity)
    ).toBe('doc-created');
  });

  it('returns null when no timeline entries include paynote ids', () => {
    const holdDetail = buildHoldDetail([
      {
        type: 'CREATED',
        at: '2024-01-01T00:00:00.000Z',
      },
    ]);

    expect(getHoldTimelinePayNoteDocumentId(holdDetail, null)).toBeNull();
  });
});
