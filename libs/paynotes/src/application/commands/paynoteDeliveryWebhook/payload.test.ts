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

  it('continues for unresolved runtime documents using raw payload fallback', () => {
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

    expect('context' in result).toBe(true);
    if (!('context' in result)) {
      return;
    }

    expect(result.context.isDeliveryDoc).toBe(true);
    expect(result.context.documentPayload?.deliveryStatus).toBe(true);
  });

  it('continues for unresolved non-delivery documents when emitted bootstrap request exists', () => {
    const logs: any[] = [];
    const result = resolveDeliveryWebhookContext(
      {
        eventId: 'event-3',
        payload: {
          id: 'event-3',
          type: 'Core/Document Epoch Advanced',
          object: {
            sessionId: 'session-3',
            document: {
              type: 'Synchrony/Merchant',
              contracts: {
                synchronyChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'bank-account',
                },
                sendPayNote: {
                  type: 'Conversation/Operation',
                },
              },
            },
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'synchronyChannel',
                document: {
                  type: 'PayNote/PayNote Delivery',
                },
              },
            ],
          },
        },
      },
      logs
    );

    expect('context' in result).toBe(true);
    if (!('context' in result)) {
      return;
    }

    expect(result.context.isDeliveryDoc).toBe(false);
    expect(result.context.documentBootstrapRequests).toHaveLength(1);
  });
});
