import { describe, expect, it } from 'vitest';
import { buildContractSummaryUpdateExpressions } from './contractSummaryUpdateBuilder';

describe('buildContractSummaryUpdateExpressions', () => {
  it('builds monotonic guard based on source epoch and updatedAt', () => {
    const result = buildContractSummaryUpdateExpressions({
      contractId: 'contract-1',
      summarySourceUpdatedAt: '2026-02-09T10:00:00.000Z',
      summarySourceEpoch: 5,
      summary: {
        story: {
          headline: 'Summary',
          overview: [],
          bullets: [],
        },
        listPreview: 'Summary',
        nextSteps: { title: 'Next steps', items: [] },
        lastChange: { short: 'Updated', more: 'Updated' },
      },
      summaryUpdatedAt: '2026-02-09T10:00:01.000Z',
      summaryPreview: 'Summary',
    });

    expect(result.primaryUpdate).toBeTruthy();
    expect(result.metadataUpdate).toBeTruthy();
    expect(result.primaryUpdate?.ConditionExpression).toContain(
      '#currentSummarySourceEpoch'
    );
    expect(result.primaryUpdate?.ConditionExpression).toContain(
      '#currentSummarySourceUpdatedAt'
    );
    expect(
      result.primaryUpdate?.ExpressionAttributeValues?.[
        ':incomingSummarySourceEpoch'
      ]
    ).toBe(5);
    expect(
      result.primaryUpdate?.ExpressionAttributeValues?.[
        ':incomingSummarySourceUpdatedAt'
      ]
    ).toBe('2026-02-09T10:00:00.000Z');
  });

  it('throws when summary source updatedAt is invalid', () => {
    expect(() =>
      buildContractSummaryUpdateExpressions({
        contractId: 'contract-1',
        summarySourceUpdatedAt: 'not-a-date',
        summarySourceEpoch: 1,
      })
    ).toThrow('summarySourceUpdatedAt');
  });

  it('removes summaryPreview when explicitly null and keeps source ordering fields in metadata', () => {
    const result = buildContractSummaryUpdateExpressions({
      contractId: 'contract-1',
      summarySourceUpdatedAt: '2026-02-09T10:00:00.000Z',
      summarySourceEpoch: 7,
      summaryPreview: null,
    });

    expect(result.shouldRemoveSummaryPreview).toBe(true);
    expect(result.metadataUpdate?.UpdateExpression).toContain(
      '#summarySourceUpdatedAt'
    );
    expect(result.metadataUpdate?.UpdateExpression).toContain(
      '#summarySourceEpoch'
    );
    expect(result.metadataUpdate?.UpdateExpression).toContain('REMOVE');
  });
});
