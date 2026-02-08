import { describe, expect, it } from 'vitest';
import {
  buildContractSummaryInputSnapshot,
  buildSummaryInputKey,
  normalizeSourceUpdatedAt,
} from './inputStore';

describe('summary input helpers', () => {
  it('builds key with epoch when available', () => {
    expect(
      buildSummaryInputKey({
        sourceUpdatedAt: '2026-02-08T12:00:00.000Z',
        sourceEpoch: 3,
      })
    ).toBe('SUMMARY_INPUT#2026-02-08T12:00:00.000Z#3');
  });

  it('normalizes ISO timestamps', () => {
    expect(
      normalizeSourceUpdatedAt(
        '2026-02-08T12:00:00.000+00:00',
        '2026-02-08T00:00:00.000Z'
      )
    ).toBe('2026-02-08T12:00:00.000Z');
  });

  it('falls back when source timestamp is invalid', () => {
    expect(
      normalizeSourceUpdatedAt('invalid', '2026-02-08T00:00:00.000Z')
    ).toBe('2026-02-08T00:00:00.000Z');
  });

  it('builds compact pointer snapshot', () => {
    const snapshot = buildContractSummaryInputSnapshot({
      contractId: 'contract-1',
      sourceUpdatedAt: '2026-02-08T12:00:00.000Z',
      createdAt: '2026-02-08T12:00:00.000Z',
      sourceEpoch: 1,
      eventId: 'event-1',
    });

    expect(snapshot).toEqual({
      contractId: 'contract-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T12:00:00.000Z#1',
      sourceUpdatedAt: '2026-02-08T12:00:00.000Z',
      sourceEpoch: 1,
      eventId: 'event-1',
      createdAt: '2026-02-08T12:00:00.000Z',
    });
  });
});
