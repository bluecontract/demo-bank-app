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
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  document:
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
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
`;
  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: PAYNOTE_DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const buildDeliveryDocumentWithError = (deliveryError: string) => {
  const yaml = `name: Delivery for Invoice
deliveryError: "${deliveryError}"
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  document:
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
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
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
      fetchDocument: vi.fn().mockResolvedValue({
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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-1',
          object: {
            sessionId: 'sync-session',
            document: {
              contracts: {
                synchronyChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'bank-account',
                },
              },
            },
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'synchronyChannel',
                channelBindings: {
                  payNoteSender: { accountId: 'merchant-account' },
                },
                document: deliveryDocument,
              },
            ],
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: payNoteDeliveryRepository as any,
        contractRepository: contractRepository as any,
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
            payNoteSender: { accountId: 'merchant-account' },
            payNoteDeliverer: { accountId: 'bank-account' },
          }),
        }),
      })
    );
  });

  it('reports delivery errors after bootstrap succeeds', async () => {
    const deliveryDocument = buildDeliveryDocumentWithError(
      'PayNote amount mismatch'
    );
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { sessionId: 'delivery-session-bootstrapped' },
      }),
      runDocumentOperation: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200 }),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn().mockResolvedValue({
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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-1',
          object: {
            sessionId: 'sync-session',
            document: {
              contracts: {
                synchronyChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'bank-account',
                },
              },
            },
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'synchronyChannel',
                channelBindings: {
                  payNoteSender: { accountId: 'merchant-account' },
                },
                document: deliveryDocument,
              },
            ],
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: payNoteDeliveryRepository as any,
        contractRepository: contractRepository as any,
        bankingRepository: {} as any,
        holdRepository: {} as any,
        clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          document: expect.any(Object),
        }),
      })
    );
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'delivery-session-bootstrapped',
        operation: 'reportDeliveryError',
        payload: 'PayNote amount mismatch',
      })
    );
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledTimes(1);
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId,
        cardTransactionDetails: cardDetails,
      })
    );
  });

  it('reports paynote bootstrap errors when amount mismatches the hold', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);
    const payNoteDocument = {
      type: 'PayNote/PayNote',
      currency: 'USD',
      amount: { total: 1200 },
    };

    const deliveryContracts = deliveryDocument.contracts as Record<
      string,
      unknown
    >;
    const payNoteDeliverer = deliveryContracts.payNoteDeliverer as Record<
      string,
      unknown
    >;
    payNoteDeliverer.accountId = 'bank-account';

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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const bankingRepository = {
      getAccountIdByNumber: vi.fn().mockResolvedValue(null),
      getAccountById: vi.fn(),
    };

    const holdRepository = {
      getHold: vi.fn(),
      getHoldByCardTransactionDetails: vi.fn().mockResolvedValue({
        holdId: 'hold-1',
        payerAccountNumber: '1234567890',
        amountMinor: 1100,
      }),
      putHoldMeta: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-1',
          object: {
            sessionId: 'delivery-session',
            document: deliveryDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
                channelBindings: {
                  payeeChannel: { accountId: 'merchant-account' },
                },
                document: payNoteDocument,
              },
            ],
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: payNoteDeliveryRepository as any,
        contractRepository: contractRepository as any,
        bankingRepository: bankingRepository as any,
        holdRepository: holdRepository as any,
        clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'delivery-session',
        operation: 'reportDeliveryError',
        payload:
          'PayNote amount (1200) does not match transaction amount (1100)',
      })
    );
    expect(payNoteDeliveryRepository.getDelivery).toHaveBeenCalledWith(
      deliveryId
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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
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
        contractRepository: contractRepository as any,
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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
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
        contractRepository: contractRepository as any,
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

  it('skips processing when event is already processed', async () => {
    const deliveryDocument = buildDeliveryDocument();

    const myOsClient = {
      getCredentials: vi.fn(),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(false),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-processed',
          object: {
            sessionId: 'sync-session',
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
                document: deliveryDocument,
              },
            ],
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: payNoteDeliveryRepository as any,
        contractRepository: contractRepository as any,
        bankingRepository: {} as any,
        holdRepository: {} as any,
        clock: { now: () => new Date('2024-01-04T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.getCredentials).not.toHaveBeenCalled();
    expect(payNoteDeliveryRepository.saveDelivery).not.toHaveBeenCalled();
  });

  it('reports identification failure when hold is missing', async () => {
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
          documentId: 'delivery-doc-2',
          sessionId: 'delivery-session-2',
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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const holdRepository = {
      getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
      getHold: vi.fn(),
      putHoldMeta: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-4',
          type: 'DOCUMENT_CREATED',
          object: {
            sessionId: 'delivery-session-2',
            created: '2024-01-04T10:00:00.000Z',
            document: deliveryDocument,
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: payNoteDeliveryRepository as any,
        contractRepository: contractRepository as any,
        bankingRepository: {} as any,
        holdRepository: holdRepository as any,
        clock: { now: () => new Date('2024-01-04T10:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId,
        transactionIdentificationStatus: 'failed',
      })
    );
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'delivery-session-2',
        operation: 'updateTransactionIdentificationStatus',
        payload: false,
      })
    );
  });

  it('logs errors when delivery bootstrap fails', async () => {
    const deliveryDocument = buildDeliveryDocument();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, body: { ok: false } }),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn().mockResolvedValue({
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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-5',
          object: {
            sessionId: 'sync-session',
            document: {
              contracts: {
                payNoteDeliverer: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'bank-account',
                },
              },
            },
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
                channelBindings: {
                  payNoteSender: { accountId: 'merchant-account' },
                },
                document: deliveryDocument,
              },
            ],
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: payNoteDeliveryRepository as any,
        contractRepository: contractRepository as any,
        bankingRepository: {} as any,
        holdRepository: {} as any,
        clock: { now: () => new Date('2024-01-05T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(
      result.logs.some(
        entry =>
          entry.level === 'error' &&
          entry.message === 'PayNote Delivery bootstrap failed'
      )
    ).toBe(true);
  });
});
