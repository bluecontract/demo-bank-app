import { describe, expect, it } from 'vitest';
import { resolveWebhookContext } from './payload';

describe('resolveWebhookContext', () => {
  it('uses resolved runtime document shape for webhook context', () => {
    const logs: any[] = [];
    const payload = {
      type: 'Core/Document Epoch Advanced',
      object: {
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          amount: { total: 500 },
          currency: 'USD',
        },
        emitted: [],
      },
    };

    const result = resolveWebhookContext(payload as any, 'event-1', logs);
    expect('context' in result).toBe(true);
    if (!('context' in result)) {
      return;
    }

    const contracts = result.context.document.contracts as
      | Record<string, unknown>
      | undefined;
    expect(contracts).toBeTruthy();
    expect(Object.keys(contracts ?? {})).toEqual(
      expect.arrayContaining([
        'payerChannel',
        'payeeChannel',
        'guarantorChannel',
      ])
    );
  });

  it('fails closed when non-mandate document runtime resolution fails', () => {
    const logs: any[] = [];
    const payload = {
      type: 'Core/Document Epoch Advanced',
      object: {
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          amount: { total: 500 },
          currency: 'USD',
          status: true,
        },
        emitted: [],
      },
    };

    const result = resolveWebhookContext(payload as any, 'event-2', logs);
    expect('result' in result).toBe(true);
    if (!('result' in result)) {
      return;
    }
    expect(result.result.note).toBe(
      'PayNote event document payload failed PayNote type validation'
    );
  });

  it('accepts unresolved runtime payload for Payment Mandate documents', () => {
    const logs: any[] = [];
    const payload = {
      type: 'Core/Document Epoch Advanced',
      object: {
        sessionId: 'session-1',
        document: {
          type: 'PayNote/Payment Mandate',
          granteeType: 'documentId',
          granteeId: 'doc-1',
          amountLimit: 100_000,
          allowLinkedPayNote: true,
        },
        emitted: [],
      },
    };

    const result = resolveWebhookContext(payload as any, 'event-3', logs);
    expect('context' in result).toBe(true);
  });
});
