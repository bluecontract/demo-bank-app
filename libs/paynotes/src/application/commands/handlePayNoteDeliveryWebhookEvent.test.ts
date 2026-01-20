import { describe, it, expect, vi } from 'vitest';
import { handlePayNoteDeliveryWebhookEvent } from './handlePayNoteDeliveryWebhookEvent';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import type { MyOsFetchDocumentResult } from '../ports';
import { PAYNOTE_DELIVERY_BLUE_ID } from '../payNoteDelivery/schema';
import { blue } from '../../blue';

const cardDetails = {
  retrievalReferenceNumber: '123456789012',
  systemTraceAuditNumber: '654321',
  transmissionDateTime: '0101123456',
  authorizationCode: 'ABC123',
};

const buildDeliveryDocument = () => {
  const yaml = `name: Delivery for Invoice
payNote:
  type: PayNote/PayNote
  currency: USD
  amount:
    total: 1200
cardTransactionDetails:
  retrievalReferenceNumber: "${cardDetails.retrievalReferenceNumber}"
  systemTraceAuditNumber: "${cardDetails.systemTraceAuditNumber}"
  transmissionDateTime: "${cardDetails.transmissionDateTime}"
  authorizationCode: "${cardDetails.authorizationCode}"
contracts:
  payNoteSender:
    type: MyOS/MyOS Timeline Channel
  links:
    synchronyMerchantLink:
      sessionId: "sync-session"
`;
  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: PAYNOTE_DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

describe('handlePayNoteDeliveryWebhookEvent', () => {
  it('bootstraps delivery when a bootstrap request is emitted', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi
        .fn()
        .mockResolvedValue({
          kind: 'not-found',
          status: 404,
        } satisfies MyOsFetchDocumentResult),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-1',
          object: {
            sessionId: 'sync-session',
            emitted: [
              {
                type: 'Conversation/Event',
                kind: 'PayNote/PayNote Delivery Bootstrap Requested',
                delivery: deliveryDocument,
              },
            ],
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: payNoteDeliveryRepository as any,
        bankingRepository: {} as any,
        holdRepository: {} as any,
        clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId,
        cardTransactionDetails: cardDetails,
      })
    );
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          document: expect.any(Object),
          channelBindings: expect.objectContaining({
            payNoteDeliverer: { accountId: 'bank-account' },
            payNoteReceiver: { accountId: 'bank-account' },
          }),
        }),
      })
    );
  });

  it('identifies delivery and reports status for delivery documents', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200 }),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn().mockResolvedValue({
        kind: 'success',
        document: {
          documentId: 'delivery-doc-1',
          sessionId: 'delivery-session-1',
          document: deliveryDocument,
        },
      } satisfies MyOsFetchDocumentResult),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByDocumentId: vi.fn().mockResolvedValue(null),
      getDeliveryBySessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByCardTransactionDetails: vi.fn().mockResolvedValue(null),
      saveDelivery: vi.fn(),
    };

    const bankingRepository = {
      getAccountIdByNumber: vi.fn().mockResolvedValue('account-1'),
      getAccountById: vi.fn().mockResolvedValue({
        id: 'account-1',
        accountNumber: '1234567890',
        ownerUserId: 'user-1',
      }),
    };

    const holdRepository = {
      getHoldByCardTransactionDetails: vi.fn().mockResolvedValue({
        holdId: 'hold-1',
        payerAccountNumber: '1234567890',
        relatedTransactionId: 'txn-1',
      }),
      putHoldMeta: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-2',
          type: 'DOCUMENT_CREATED',
          object: {
            sessionId: 'delivery-session-1',
            created: '2024-01-02T10:00:00.000Z',
            document: deliveryDocument,
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: payNoteDeliveryRepository as any,
        bankingRepository: bankingRepository as any,
        holdRepository: holdRepository as any,
        clock: { now: () => new Date('2024-01-02T10:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId,
        deliveryDocumentId: 'delivery-doc-1',
        userId: 'user-1',
        holdId: 'hold-1',
        transactionId: 'txn-1',
        transactionIdentificationStatus: 'identified',
      })
    );
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'delivery-session-1',
        operation: 'updateTransactionIdentificationStatus',
        payload: true,
      })
    );
  });

  it('promotes pending identification when user is already linked', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);
    const now = '2024-01-03T10:00:00.000Z';

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200 }),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn().mockResolvedValue({
        kind: 'success',
        document: {
          documentId: 'delivery-doc-1',
          sessionId: 'delivery-session-1',
          document: deliveryDocument,
        },
      } satisfies MyOsFetchDocumentResult),
    };

    const existingRecord = {
      deliveryId,
      deliveryDocumentId: 'delivery-doc-1',
      deliverySessionId: 'delivery-session-1',
      deliverySessionIds: ['delivery-session-1'],
      synchronySessionId: 'sync-session',
      cardTransactionDetails: cardDetails,
      cardTransactionDetailsKey: deliveryId,
      accountNumber: '1234567890',
      userId: 'user-1',
      holdId: 'hold-1',
      transactionId: 'txn-1',
      transactionIdentificationStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByDocumentId: vi.fn().mockResolvedValue(existingRecord),
      getDeliveryBySessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByCardTransactionDetails: vi.fn().mockResolvedValue(null),
      saveDelivery: vi.fn(),
    };

    const holdRepository = {
      getHoldByCardTransactionDetails: vi.fn(),
      getHold: vi.fn().mockResolvedValue({
        holdId: 'hold-1',
        payerAccountNumber: '1234567890',
      }),
      putHoldMeta: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-3',
          type: 'DOCUMENT_EPOCH_ADVANCED',
          object: {
            sessionId: 'delivery-session-1',
            created: now,
            document: deliveryDocument,
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: payNoteDeliveryRepository as any,
        bankingRepository: {} as any,
        holdRepository: holdRepository as any,
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(
      holdRepository.getHoldByCardTransactionDetails
    ).not.toHaveBeenCalled();
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId,
        transactionIdentificationStatus: 'identified',
      })
    );
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'delivery-session-1',
        operation: 'updateTransactionIdentificationStatus',
        payload: true,
      })
    );
  });
});
