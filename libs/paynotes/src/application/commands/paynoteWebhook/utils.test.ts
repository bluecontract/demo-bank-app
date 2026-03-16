import { describe, expect, it } from 'vitest';
import { parsePayNoteDocument } from './utils';

describe('parsePayNoteDocument', () => {
  it('fails closed for unresolved non-mandate documents', () => {
    const parsed = parsePayNoteDocument({
      type: 'PayNote/PayNote',
      amount: { total: 100 },
      currency: 'USD',
      status: true,
    });

    expect(parsed).toBeNull();
  });

  it('accepts unresolved Payment Mandate documents', () => {
    const parsed = parsePayNoteDocument({
      type: 'PayNote/Payment Mandate',
      granteeType: 'documentId',
      granteeId: 'doc-1',
      amountLimit: 100_000,
      allowLinkedPayNote: true,
    });

    expect(parsed).toBeTruthy();
    const output = parsed?.output as Record<string, unknown> | undefined;
    expect(output?.granteeType).toBe('documentId');
    expect(output?.granteeId).toBe('doc-1');
  });
});
