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

const bootstrapContextRepository = {
  saveContext: vi.fn(),
  getContextBySessionId: vi.fn(),
};

const buildDeliveryDocument = () => {
  const yaml = `name: Delivery for Invoice
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  document:
    type: PayNote/Card Transaction PayNote
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
    accountId: merchant-account
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
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
    type: PayNote/Card Transaction PayNote
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
    accountId: merchant-account
  payNoteDeliverer:
    type: MyOS/MyOS Timeline Channel
    accountId: bank-account
`;
  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: PAYNOTE_DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const buildActivePayNoteDocument = () => ({
  type: 'PayNote/PayNote',
  name: 'Active card transaction paynote',
  contracts: {
    payerChannel: {
      type: 'MyOS/MyOS Timeline Channel',
      accountId: 'customer-account-id',
    },
    payeeChannel: {
      type: 'MyOS/MyOS Timeline Channel',
      accountId: 'merchant-account-id',
    },
    guarantorChannel: {
      type: 'MyOS/MyOS Timeline Channel',
      accountId: 'bank-account',
    },
  },
});

const buildPayNoteWithCounterDocument = () => ({
  type: 'PayNote/PayNote',
  name: 'PayNote with Counter',
  currency: 'USD',
  amount: {
    total: 1,
  },
  counter: 0,
  contracts: {
    payerChannel: {
      type: 'MyOS/MyOS Timeline Channel',
    },
    payeeChannel: {
      type: 'MyOS/MyOS Timeline Channel',
    },
    guarantorChannel: {
      type: 'MyOS/MyOS Timeline Channel',
    },
    incrementCounter: {
      type: 'Conversation/Operation',
      channel: 'payerChannel',
      request: {
        type: 'Integer',
      },
    },
    incrementCounterImpl: {
      type: 'Conversation/Sequential Workflow Operation',
      operation: 'incrementCounter',
      steps: [
        {
          type: 'Conversation/Update Document',
          changeset: [
            {
              op: 'replace',
              path: '/counter',
              val: "${document('/counter') + event.message.request}",
            },
          ],
        },
      ],
    },
  },
});

const getDocumentOperationCalls = (myOsClient: {
  runDocumentOperation: unknown;
}): Array<{
  sessionId?: string;
  operation?: string;
  payload?: unknown;
}> =>
  (
    myOsClient.runDocumentOperation as {
      mock: {
        calls: Array<
          Array<{ sessionId?: string; operation?: string; payload?: unknown }>
        >;
      };
    }
  ).mock.calls.map(call => call[0]);

const getOperationCall = (
  myOsClient: { runDocumentOperation: unknown },
  operation: string
): { sessionId?: string; operation?: string; payload?: unknown } | undefined =>
  getDocumentOperationCalls(myOsClient).find(
    call => call.operation === operation
  );

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
                sendPayNote: {
                  type: 'Conversation/Operation',
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
        bootstrapContextRepository,
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
                sendPayNote: {
                  type: 'Conversation/Operation',
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
        bootstrapContextRepository,
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
    const guarantorUpdatePayloads = getDocumentOperationCalls(myOsClient)
      .filter(call => call.operation === 'guarantorUpdate')
      .map(call => JSON.stringify(call.payload));
    expect(
      guarantorUpdatePayloads.some(payload => payload.includes('accepted'))
    ).toBe(true);
    expect(
      guarantorUpdatePayloads.some(payload =>
        payload.includes('Conversation/Document Bootstrap Responded')
      )
    ).toBe(true);
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledTimes(2);
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId,
        cardTransactionDetails: cardDetails,
      })
    );
  });

  it('bootstraps allow-listed paynote from active paynote session using provided bindings', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();
    bootstrapContextRepository.saveContext.mockClear();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { sessionId: 'voucher-session-1' },
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
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '9559276001',
        userId: 'customer-user-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-10T00:00:00.000Z',
        updatedAt: '2024-01-10T00:00:00.000Z',
      }),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
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
          id: 'event-bootstrap-paynote-counter',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'customer-account-id' },
                  payeeChannel: { accountId: 'merchant-account-id' },
                },
                document: counterPayNoteDocument,
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
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          channelBindings: {
            payerChannel: { accountId: 'customer-account-id' },
            payeeChannel: { accountId: 'merchant-account-id' },
            guarantorChannel: { accountId: 'bank-account' },
          },
          document: expect.objectContaining({
            type: 'PayNote/PayNote',
            name: 'PayNote with Counter',
          }),
        }),
      })
    );
    expect(bootstrapContextRepository.saveContext).toHaveBeenCalledWith({
      bootstrapSessionId: 'voucher-session-1',
      merchantId: 'merchant-1',
      accountNumber: '9559276001',
      userId: 'customer-user-1',
      requestingSessionId: 'active-paynote-session-1',
      createdAt: '2024-01-10T00:00:00.000Z',
    });
  });

  it('rejects active paynote bootstrap when guarantor binding conflicts with bank account', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();

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
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '9559276001',
        userId: 'customer-user-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-10T00:00:00.000Z',
        updatedAt: '2024-01-10T00:00:00.000Z',
      }),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
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
          id: 'event-bootstrap-paynote-counter-guarantor-conflict',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'customer-account-id' },
                  payeeChannel: { accountId: 'merchant-account-id' },
                  guarantorChannel: { accountId: 'external-guarantor' },
                },
                document: counterPayNoteDocument,
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
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeDefined();
    const payload = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
    expect(payload).toContain(
      'guarantorChannel must be bound to the bank guarantor account for bootstrap.'
    );
  });

  it('stores customer channel key when active bootstrap bindings contain bank account id', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const activeContracts = activePayNoteDocument.contracts as Record<
      string,
      unknown
    >;
    (activeContracts.payerChannel as Record<string, unknown>).accountId =
      'bank-account';
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();
    bootstrapContextRepository.saveContext.mockClear();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { sessionId: 'voucher-session-channel-key' },
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
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '9559276001',
        userId: 'customer-user-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-10T00:00:00.000Z',
        updatedAt: '2024-01-10T00:00:00.000Z',
      }),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
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
          id: 'event-bootstrap-paynote-counter-channel-key',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'bank-account' },
                  payeeChannel: { accountId: 'merchant-account-id' },
                },
                document: counterPayNoteDocument,
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
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(bootstrapContextRepository.saveContext).toHaveBeenCalledWith({
      bootstrapSessionId: 'voucher-session-channel-key',
      merchantId: 'merchant-1',
      accountNumber: '9559276001',
      userId: 'customer-user-1',
      customerChannelKey: 'payerChannel',
      requestingSessionId: 'active-paynote-session-1',
      createdAt: '2024-01-10T00:00:00.000Z',
    });
  });

  it('reports bootstrap responded with requestId and stores bootstrap response context', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();
    bootstrapContextRepository.saveContext.mockClear();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          sessionId: 'voucher-session-request-id',
          documentId: 'voucher-doc-1',
        },
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
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '9559276001',
        userId: 'customer-user-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-10T00:00:00.000Z',
        updatedAt: '2024-01-10T00:00:00.000Z',
      }),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
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
          id: 'event-bootstrap-request-id',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                requestId: 'bootstrap-request-1',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'customer-account-id' },
                  payeeChannel: { accountId: 'merchant-account-id' },
                },
                document: counterPayNoteDocument,
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
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    const guarantorPayloads = getDocumentOperationCalls(myOsClient)
      .filter(call => call.operation === 'guarantorUpdate')
      .map(call => JSON.stringify(call.payload));
    expect(guarantorPayloads.length).toBe(1);
    expect(
      guarantorPayloads.some(payload => payload.includes('accepted'))
    ).toBe(true);
    expect(
      guarantorPayloads.some(payload =>
        payload.includes('Conversation/Document Bootstrap Responded')
      )
    ).toBe(true);
    expect(
      guarantorPayloads.every(payload =>
        payload.includes('bootstrap-request-1')
      )
    ).toBe(true);
    expect(bootstrapContextRepository.saveContext).toHaveBeenCalledWith({
      bootstrapSessionId: 'voucher-session-request-id',
      merchantId: 'merchant-1',
      accountNumber: '9559276001',
      userId: 'customer-user-1',
      requestingSessionId: 'active-paynote-session-1',
      requestId: 'bootstrap-request-1',
      createdAt: '2024-01-10T00:00:00.000Z',
    });
  });

  it('omits inResponseTo when requestId is not provided', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          sessionId: 'voucher-session-no-request',
          documentId: 'voucher-doc-2',
        },
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

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-no-request-id',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'customer-account-id' },
                  payeeChannel: { accountId: 'merchant-account-id' },
                },
                document: counterPayNoteDocument,
              },
            ],
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: {
          markEventProcessed: vi.fn().mockResolvedValue(true),
          getDelivery: vi.fn(),
          getDeliveryByDocumentId: vi.fn(),
          getDeliveryBySessionId: vi.fn().mockResolvedValue({
            deliveryId: 'delivery-1',
            accountNumber: '9559276001',
            userId: 'customer-user-1',
            merchantId: 'merchant-1',
            createdAt: '2024-01-10T00:00:00.000Z',
            updatedAt: '2024-01-10T00:00:00.000Z',
          }),
          getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
          getDeliveryByPayNoteDocumentId: vi.fn(),
          getDeliveryByCardTransactionDetails: vi.fn(),
          saveDelivery: vi.fn(),
          listDeliveriesByUserId: vi.fn(),
        } as any,
        contractRepository: {
          getContract: vi.fn(),
          getContractByDocumentId: vi.fn(),
          saveContract: vi.fn(),
        } as any,
        bankingRepository: {} as any,
        holdRepository: {} as any,
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    const guarantorPayloads = getDocumentOperationCalls(myOsClient)
      .filter(call => call.operation === 'guarantorUpdate')
      .map(call => JSON.stringify(call.payload));
    expect(guarantorPayloads.length).toBe(1);
    expect(guarantorPayloads.join(' ')).not.toContain('inResponseTo');
  });

  it('bootstraps allow-listed paynote from active session when delivery is resolved by contract document id', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();
    bootstrapContextRepository.saveContext.mockClear();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { sessionId: 'voucher-session-2' },
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
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '9559276001',
        userId: 'customer-user-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-10T00:00:00.000Z',
        updatedAt: '2024-01-10T00:00:00.000Z',
      }),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi
        .fn()
        .mockResolvedValue({ documentId: 'active-paynote-doc-1' }),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-paynote-counter-via-contract',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'customer-account-id' },
                  payeeChannel: { accountId: 'merchant-account-id' },
                },
                document: counterPayNoteDocument,
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
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(contractRepository.getContractBySessionId).toHaveBeenCalledWith(
      'active-paynote-session-1'
    );
    expect(
      payNoteDeliveryRepository.getDeliveryByPayNoteDocumentId
    ).toHaveBeenCalledWith('active-paynote-doc-1');
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          channelBindings: {
            payerChannel: { accountId: 'customer-account-id' },
            payeeChannel: { accountId: 'merchant-account-id' },
            guarantorChannel: { accountId: 'bank-account' },
          },
          document: expect.objectContaining({
            type: 'PayNote/PayNote',
            name: 'PayNote with Counter',
          }),
        }),
      })
    );
  });

  it('ignores active paynote bootstrap from unknown or non-canonical session without responding', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();

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
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '9559276001',
        userId: 'customer-user-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-10T00:00:00.000Z',
        updatedAt: '2024-01-10T00:00:00.000Z',
      }),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-non-canonical-session',
          object: {
            sessionId: 'active-paynote-session-non-canonical',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'customer-account-id' },
                  payeeChannel: { accountId: 'merchant-account-id' },
                },
                document: counterPayNoteDocument,
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
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(contractRepository.getContractBySessionId).toHaveBeenCalledWith(
      'active-paynote-session-non-canonical'
    );
    expect(
      payNoteDeliveryRepository.getDeliveryBySessionId
    ).not.toHaveBeenCalled();
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(getOperationCall(myOsClient, 'guarantorUpdate')).toBeUndefined();
    expect(
      result.logs.some(
        entry =>
          entry.message ===
          'Bootstrap requests ignored (unknown or non-canonical requesting session)'
      )
    ).toBe(true);
  });

  it('ignores active paynote bootstrap when payer/payee bindings are missing', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();

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
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '9559276001',
        userId: 'customer-user-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-10T00:00:00.000Z',
        updatedAt: '2024-01-10T00:00:00.000Z',
      }),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
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
          id: 'event-bootstrap-paynote-counter-missing-bindings',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'customer-account-id' },
                },
                document: counterPayNoteDocument,
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
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(
      result.logs.some(
        entry =>
          entry.level === 'warn' &&
          entry.message ===
            'Bootstrap request ignored (invalid payer/payee bindings for active PayNote bootstrap)'
      )
    ).toBe(true);
  });

  it('reports paynote bootstrap errors when amount mismatches the hold', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);
    const payNoteDocument = {
      type: 'PayNote/Card Transaction PayNote',
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
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeDefined();
    expect(guarantorUpdateCall).toEqual(
      expect.objectContaining({
        sessionId: 'delivery-session',
        operation: 'guarantorUpdate',
      })
    );
    const payload = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
    expect(payload).toContain(
      'PayNote amount (1200) does not match transaction amount (1100)'
    );
    expect(payNoteDeliveryRepository.getDelivery).toHaveBeenCalledWith(
      deliveryId
    );
  });

  it('reports delivery errors when paynote type is unsupported', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const payNoteDocument = {
      type: 'PayNote/PayNote',
      currency: 'USD',
      amount: { total: 1200 },
    };

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

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-unsupported',
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
        bankingRepository: {} as any,
        holdRepository: {
          getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
        } as any,
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeDefined();
    expect(guarantorUpdateCall).toEqual(
      expect.objectContaining({
        sessionId: 'delivery-session',
        operation: 'guarantorUpdate',
      })
    );
    const payload = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
    expect(payload).toContain(
      'Unsupported PayNote type. Expected PayNote/Card Transaction PayNote.'
    );
  });

  it('reports delivery errors when payer binding is supplied', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const payNoteDocument = {
      type: 'PayNote/Card Transaction PayNote',
      currency: 'USD',
      amount: { total: 1200 },
    };

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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-payer-binding',
          object: {
            sessionId: 'delivery-session',
            document: deliveryDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
                channelBindings: {
                  payeeChannel: { accountId: 'merchant-account' },
                  payerChannel: { accountId: 'payer-account' },
                },
                document: payNoteDocument,
              },
            ],
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: {
          markEventProcessed: vi.fn().mockResolvedValue(true),
          saveDelivery: vi.fn(),
          getDelivery: vi.fn().mockResolvedValue(null),
          getDeliveryByDocumentId: vi.fn(),
          getDeliveryBySessionId: vi.fn(),
          getDeliveryByBootstrapSessionId: vi.fn(),
          getDeliveryByPayNoteDocumentId: vi.fn(),
          getDeliveryByCardTransactionDetails: vi.fn(),
          listDeliveriesByUserId: vi.fn(),
        } as any,
        contractRepository: contractRepository as any,
        bankingRepository: {} as any,
        holdRepository: {
          getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
        } as any,
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeDefined();
    expect(guarantorUpdateCall).toEqual(
      expect.objectContaining({
        sessionId: 'delivery-session',
        operation: 'guarantorUpdate',
      })
    );
    const payload = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
    expect(payload).toContain(
      'Payer binding must not be provided by merchant.'
    );
  });

  it('reports delivery errors when payee does not match delivery sender', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const payNoteDocument = {
      type: 'PayNote/Card Transaction PayNote',
      currency: 'USD',
      amount: { total: 1200 },
    };

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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-payee-mismatch',
          object: {
            sessionId: 'delivery-session',
            document: deliveryDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
                channelBindings: {
                  payeeChannel: { accountId: 'other-merchant' },
                },
                document: payNoteDocument,
              },
            ],
          },
        },
      },
      {
        myOsClient: myOsClient as any,
        payNoteDeliveryRepository: {
          markEventProcessed: vi.fn().mockResolvedValue(true),
          saveDelivery: vi.fn(),
          getDelivery: vi.fn().mockResolvedValue(null),
          getDeliveryByDocumentId: vi.fn(),
          getDeliveryBySessionId: vi.fn(),
          getDeliveryByBootstrapSessionId: vi.fn(),
          getDeliveryByPayNoteDocumentId: vi.fn(),
          getDeliveryByCardTransactionDetails: vi.fn(),
          listDeliveriesByUserId: vi.fn(),
        } as any,
        contractRepository: contractRepository as any,
        bankingRepository: {} as any,
        holdRepository: {
          getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
        } as any,
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeDefined();
    expect(guarantorUpdateCall).toEqual(
      expect.objectContaining({
        sessionId: 'delivery-session',
        operation: 'guarantorUpdate',
      })
    );
    const payload = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
    expect(payload).toContain('Payee binding must match the delivery sender.');
  });

  it('reports delivery errors when paynote guarantor channel conflicts with bank account', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const payNoteDocument = {
      type: 'PayNote/Card Transaction PayNote',
      currency: 'USD',
      amount: { total: 1200 },
      contracts: {
        guarantorChannel: {
          type: 'MyOS/MyOS Timeline Channel',
          accountId: 'other-guarantor',
        },
      },
    };

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
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-guarantor-conflict',
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
        payNoteDeliveryRepository: {
          markEventProcessed: vi.fn().mockResolvedValue(true),
          saveDelivery: vi.fn(),
          getDelivery: vi.fn().mockResolvedValue(null),
          getDeliveryByDocumentId: vi.fn(),
          getDeliveryBySessionId: vi.fn(),
          getDeliveryByBootstrapSessionId: vi.fn(),
          getDeliveryByPayNoteDocumentId: vi.fn(),
          getDeliveryByCardTransactionDetails: vi.fn(),
          listDeliveriesByUserId: vi.fn(),
        } as any,
        contractRepository: contractRepository as any,
        bankingRepository: {} as any,
        holdRepository: {
          getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
        } as any,
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeDefined();
    expect(guarantorUpdateCall).toEqual(
      expect.objectContaining({
        sessionId: 'delivery-session',
        operation: 'guarantorUpdate',
      })
    );
    const payload = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
    expect(payload).toContain(
      'guarantorChannel must be bound to the bank guarantor account for bootstrap.'
    );
  });

  it('identifies delivery and reports status for delivery documents', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);
    const enqueuePayNoteDeliverySummary = vi.fn().mockResolvedValue(undefined);

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
        bootstrapContextRepository,
        enqueuePayNoteDeliverySummary,
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
    expect(enqueuePayNoteDeliverySummary).toHaveBeenCalledWith({
      sessionId: 'delivery-session-1',
      reason: 'delivery-update',
    });
  });

  it('promotes pending identification when user is already linked', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);
    const now = '2024-01-03T10:00:00.000Z';
    const enqueuePayNoteDeliverySummary = vi.fn().mockResolvedValue(undefined);

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
        bootstrapContextRepository,
        enqueuePayNoteDeliverySummary,
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
    expect(enqueuePayNoteDeliverySummary).toHaveBeenCalledWith({
      sessionId: 'delivery-session-1',
      reason: 'delivery-update',
    });
  });

  it('ignores non-canonical delivery session updates', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);
    const now = '2024-01-03T10:00:00.000Z';
    const enqueuePayNoteDeliverySummary = vi.fn().mockResolvedValue(undefined);

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
          sessionId: 'delivery-session-2',
          document: deliveryDocument,
        },
      } satisfies MyOsFetchDocumentResult),
    };

    const existingRecord = {
      deliveryId,
      deliveryDocumentId: 'delivery-doc-1',
      deliverySessionId: 'delivery-session-legacy',
      deliverySessionIds: ['delivery-session-legacy'],
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
      getContractByDocumentId: vi.fn().mockResolvedValue({
        contractId: 'contract-1',
        sessionId: 'delivery-session-1',
        documentId: 'delivery-doc-1',
        createdAt: now,
        updatedAt: now,
      }),
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
          id: 'event-3-non-canonical',
          type: 'DOCUMENT_EPOCH_ADVANCED',
          object: {
            sessionId: 'delivery-session-2',
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
        bootstrapContextRepository,
        enqueuePayNoteDeliverySummary,
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(payNoteDeliveryRepository.saveDelivery).not.toHaveBeenCalled();
    expect(myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(
      holdRepository.getHoldByCardTransactionDetails
    ).not.toHaveBeenCalled();
    expect(enqueuePayNoteDeliverySummary).not.toHaveBeenCalled();
    expect(
      result.logs.some(
        entry =>
          entry.message === 'Delivery event ignored (non-canonical session)'
      )
    ).toBe(true);
  });

  it('skips processing when event is already processed', async () => {
    const deliveryDocument = buildDeliveryDocument();

    const myOsClient = {
      getCredentials: vi.fn(),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200 }),
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
        bootstrapContextRepository,
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
    const enqueuePayNoteDeliverySummary = vi.fn().mockResolvedValue(undefined);

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
        bootstrapContextRepository,
        enqueuePayNoteDeliverySummary,
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
    expect(enqueuePayNoteDeliverySummary).not.toHaveBeenCalled();
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
          id: 'event-5',
          object: {
            sessionId: 'sync-session',
            document: {
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
        bootstrapContextRepository,
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
