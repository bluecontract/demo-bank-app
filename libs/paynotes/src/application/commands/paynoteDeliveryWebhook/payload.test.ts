import { describe, expect, it } from 'vitest';
import { resolveDeliveryWebhookContext } from './payload';
import {
  buildSchemaShapedDocumentBootstrapRequestedEvent,
  buildSchemaShapedDocumentBootstrapRequestedNode,
  buildSynchronyDocumentWithCheckpointBootstrapRequest,
} from './testFixtures';

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

  it('detects schema-shaped emitted bootstrap requests from synchrony documents', () => {
    const logs: any[] = [];
    const result = resolveDeliveryWebhookContext(
      {
        eventId: 'event-4',
        payload: {
          id: 'event-4',
          type: 'Core/Document Epoch Advanced',
          object: {
            sessionId: 'session-4',
            document: {
              name: 'Synchrony Merchant',
              type: 'Synchrony/Merchant',
            },
            emitted: [buildSchemaShapedDocumentBootstrapRequestedEvent()],
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

  it('detects schema-shaped emitted bootstrap request nodes from synchrony documents', () => {
    const logs: any[] = [];
    const result = resolveDeliveryWebhookContext(
      {
        eventId: 'event-5',
        payload: {
          id: 'event-5',
          type: 'Core/Document Epoch Advanced',
          object: {
            sessionId: 'session-5',
            document: {
              name: 'Synchrony Merchant',
              type: 'Synchrony/Merchant',
            },
            emitted: [buildSchemaShapedDocumentBootstrapRequestedNode()],
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

  it('detects checkpoint-stashed bootstrap requests from synchrony documents', () => {
    const logs: any[] = [];
    const result = resolveDeliveryWebhookContext(
      {
        eventId: 'event-6',
        payload: {
          id: 'event-6',
          type: 'Core/Document Epoch Advanced',
          object: {
            sessionId: 'session-6',
            document: buildSynchronyDocumentWithCheckpointBootstrapRequest(),
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

    expect(result.context.isDeliveryDoc).toBe(false);
    expect(result.context.documentBootstrapRequests).toHaveLength(1);
  });
});
