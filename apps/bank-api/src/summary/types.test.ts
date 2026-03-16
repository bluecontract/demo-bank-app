import { describe, expect, it } from 'vitest';
import { isSummaryJob } from './types';

describe('summary job payload guards', () => {
  it('accepts contract-summary pointer jobs', () => {
    expect(
      isSummaryJob({
        type: 'contract-summary',
        messageVersion: 1,
        contractId: 'contract-1',
        documentId: 'document-1',
        summaryInputKey: 'SUMMARY_INPUT#2026-02-08T12:00:00.000Z#5',
        sourceUpdatedAt: '2026-02-08T12:00:00.000Z',
        sourceEpoch: 5,
      })
    ).toBe(true);
  });

  it('accepts paynote-delivery-summary jobs', () => {
    expect(
      isSummaryJob({
        type: 'paynote-delivery-summary',
        sessionId: 'session-1',
      })
    ).toBe(true);
  });

  it('rejects malformed contract-summary jobs', () => {
    expect(
      isSummaryJob({
        type: 'contract-summary',
        contractId: 'contract-1',
        documentId: 'document-1',
        sourceUpdatedAt: '2026-02-08T12:00:00.000Z',
      })
    ).toBe(false);
  });
});
