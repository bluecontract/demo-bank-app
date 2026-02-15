import { describe, expect, it } from 'vitest';
import { resolveDeliveryWebhookContext } from './payload';

describe('resolveDeliveryWebhookContext', () => {
  it('uses resolved runtime document shape for delivery webhook context', () => {
    const logs: any[] = [];
    const result = resolveDeliveryWebhookContext(
      {
        eventId: 'event-1',
        payload: {
          id: 'event-1',
          type: 'Core/Document Epoch Advanced',
          object: {
            sessionId: 'session-1',
            document: {
              type: 'PayNote/PayNote Delivery',
              cardTransactionDetails: {
                retrievalReferenceNumber: '123456789012',
                systemTraceAuditNumber: '123456',
                transmissionDateTime: '0214140000',
                authorizationCode: 'ABC123',
              },
            },
            emitted: [],
          },
        },
      },
      logs
    );

    expect('context' in result).toBe(true);
    if (!('context' in result)) {
      return;
    }

    const contracts = result.context.documentPayload?.contracts as
      | Record<string, unknown>
      | undefined;
    expect(contracts).toBeTruthy();
    expect(Object.keys(contracts ?? {})).toEqual(
      expect.arrayContaining([
        'acceptPayNote',
        'rejectPayNote',
        'payNoteDeliverer',
      ])
    );
  });

  it('fails closed for unresolved runtime documents', () => {
    const logs: any[] = [];
    const result = resolveDeliveryWebhookContext(
      {
        eventId: 'event-2',
        payload: {
          id: 'event-2',
          type: 'Core/Document Epoch Advanced',
          object: {
            sessionId: 'session-2',
            document: {
              type: 'PayNote/PayNote Delivery',
              deliveryStatus: true,
            },
            emitted: [],
          },
        },
      },
      logs
    );

    expect('result' in result).toBe(true);
    if (!('result' in result)) {
      return;
    }

    expect(result.result.handled).toBe(false);
    expect(result.result.note).toBe(
      'Delivery document failed runtime resolution'
    );
  });
});
