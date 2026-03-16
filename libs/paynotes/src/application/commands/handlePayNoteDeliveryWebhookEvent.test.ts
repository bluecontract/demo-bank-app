import { describe, it, expect, vi } from 'vitest';
import { handlePayNoteDeliveryWebhookEvent } from './handlePayNoteDeliveryWebhookEvent';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import type { MyOsFetchDocumentResult } from '../ports';
import { PAYNOTE_DELIVERY_BLUE_ID } from '../payNoteDelivery/schema';
import { blue } from '../../blue';
import { buildSchemaShapedDocumentBootstrapRequestedNode } from './paynoteDeliveryWebhook/testFixtures';

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

const CI_ONLY_SLOW_TEST_TIMEOUT_MS = process.env.CI === 'true' ? 45000 : 20000;

const buildDeliveryDocument = () => {
  const yaml = `name: Delivery for Invoice
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  channelBindings:
    payeeChannel:
      accountId: merchant-account
    cardProcessorChannel:
      accountId: processor-account
  document:
    type: PayNote/Card Transaction PayNote
    currency: USD
    amount:
      total: 1200
    contracts:
      payerChannel:
        type: MyOS/MyOS Timeline Channel
      payeeChannel:
        type: MyOS/MyOS Timeline Channel
      cardProcessorChannel:
        type: MyOS/MyOS Timeline Channel
      guarantorChannel:
        type: MyOS/MyOS Timeline Channel
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
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
`;
  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: PAYNOTE_DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const withSynchronyMerchantSessionLink = (
  document: Record<string, unknown>,
  sessionId: string
) => {
  const contracts =
    (document.contracts as Record<string, unknown> | undefined) ?? {};
  const links = (contracts.links as Record<string, unknown> | undefined) ?? {};
  links.synchronyMerchantLink = {
    sessionId,
  };
  contracts.links = links;
  document.contracts = contracts;
  return document;
};

const buildSchemaShapedDeliveryDocument = () => ({
  name: 'Schema-shaped delivery',
  type: {
    blueId: PAYNOTE_DELIVERY_BLUE_ID,
  },
  cardTransactionDetails: {
    retrievalReferenceNumber: {
      value: cardDetails.retrievalReferenceNumber,
    },
    systemTraceAuditNumber: {
      value: cardDetails.systemTraceAuditNumber,
    },
    transmissionDateTime: {
      value: cardDetails.transmissionDateTime,
    },
    authorizationCode: {
      value: cardDetails.authorizationCode,
    },
  },
  contracts: {
    payNoteSender: {
      type: {
        blueId: 'HCF8mXnX3dFjQ8osjxb4Wzm2Nm1DoXnTYuA5sPnV7NTs',
      },
      accountId: {
        value: 'merchant-account',
      },
    },
    payNoteDeliverer: {
      type: {
        blueId: 'HCF8mXnX3dFjQ8osjxb4Wzm2Nm1DoXnTYuA5sPnV7NTs',
      },
      accountId: {
        value: 'bank-account',
      },
    },
    links: {
      synchronyMerchantLink: {
        type: {
          blueId: 'd1vQ8ZTPcQc5KeuU6tzWaVukWRVtKjQL4hbvbpC22rB',
        },
        sessionId: {
          value: 'canonical-sync-session',
        },
      },
    },
  },
});

const buildDeliveryDocumentWithError = (deliveryError: string) => {
  const yaml = `name: Delivery for Invoice
deliveryError: "${deliveryError}"
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  channelBindings:
    payeeChannel:
      accountId: merchant-account
    cardProcessorChannel:
      accountId: processor-account
  document:
    type: PayNote/Card Transaction PayNote
    currency: USD
    amount:
      total: 1200
    contracts:
      payerChannel:
        type: MyOS/MyOS Timeline Channel
      payeeChannel:
        type: MyOS/MyOS Timeline Channel
      cardProcessorChannel:
        type: MyOS/MyOS Timeline Channel
      guarantorChannel:
        type: MyOS/MyOS Timeline Channel
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
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
`;
  const node = blue.yamlToNode(yaml);
  node.setType(blue.jsonValueToNode({ blueId: PAYNOTE_DELIVERY_BLUE_ID }));
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const buildDeliveryDocumentWithPayNoteMandate = (mandateDocumentId: string) => {
  const yaml = `name: Delivery for Invoice
payNoteBootstrapRequest:
  type: Conversation/Document Bootstrap Requested
  bootstrapAssignee: payNoteDeliverer
  channelBindings:
    payeeChannel:
      accountId: merchant-account
    cardProcessorChannel:
      accountId: processor-account
  document:
    type: PayNote/Card Transaction PayNote
    currency: USD
    amount:
      total: 1200
    paymentMandateDocumentId: "${mandateDocumentId}"
    contracts:
      payerChannel:
        type: MyOS/MyOS Timeline Channel
      payeeChannel:
        type: MyOS/MyOS Timeline Channel
      cardProcessorChannel:
        type: MyOS/MyOS Timeline Channel
      guarantorChannel:
        type: MyOS/MyOS Timeline Channel
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
  cardProcessorChannel:
    type: MyOS/MyOS Timeline Channel
    accountId: processor-account
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

const buildMerchantToCustomerPayNoteDocument = () => ({
  type: 'PayNote/Merchant To Customer PayNote',
  name: 'Merchant cashback voucher',
  currency: 'USD',
  amount: {
    total: 100,
  },
  voucher: {
    merchantId: 'merchant-1',
  },
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
  },
});

const buildSynchronyRequestingDocument = () => ({
  type: 'Synchrony/Merchant',
  contracts: {
    merchantChannel: {
      type: 'MyOS/MyOS Timeline Channel',
      accountId: 'merchant-account',
    },
    synchronyChannel: {
      type: 'MyOS/MyOS Timeline Channel',
      accountId: 'bank-account',
    },
    sendPayNote: {
      type: 'Conversation/Operation',
      channel: 'merchantChannel',
    },
    cardProcessorChannel: {
      type: 'MyOS/MyOS Timeline Channel',
      accountId: 'processor-account',
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
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
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
                cardProcessorChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'processor-account',
                },
              },
            },
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'synchronyChannel',
                channelBindings: {
                  payNoteSender: { accountId: 'merchant-account' },
                  cardProcessorChannel: { accountId: 'processor-account' },
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
            cardProcessorChannel: { accountId: 'processor-account' },
            payNoteDeliverer: { accountId: 'bank-account' },
          }),
        }),
      })
    );
    expect(
      payNoteDeliveryRepository.finalizeEventProcessing
    ).toHaveBeenCalledWith('event-1');
    expect(
      payNoteDeliveryRepository.releaseEventProcessing
    ).not.toHaveBeenCalled();
  });

  it('bootstraps delivery from schema-shaped synchrony bootstrap request nodes', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const deliveryId = buildCardTransactionDetailsKey(cardDetails);

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, body: {} }),
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
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-1b',
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
                cardProcessorChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'processor-account',
                },
              },
            },
            emitted: [
              {
                ...buildSchemaShapedDocumentBootstrapRequestedNode(),
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
          channelBindings: expect.objectContaining({
            payNoteSender: { accountId: 'merchant-account' },
            cardProcessorChannel: { accountId: 'processor-account' },
            payNoteDeliverer: { accountId: 'bank-account' },
          }),
        }),
      })
    );
    expect(
      payNoteDeliveryRepository.finalizeEventProcessing
    ).toHaveBeenCalledWith('event-1b');
  });

  it('treats blueId-only synchrony bootstrap document nodes as delivery documents', async () => {
    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-1c',
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
            emitted: [buildSchemaShapedDocumentBootstrapRequestedNode()],
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
    expect(
      result.logs.some(
        entry =>
          entry.level === 'warn' &&
          entry.message === 'Delivery missing card transaction details'
      )
    ).toBe(true);
    expect(
      result.logs.some(
        entry =>
          entry.level === 'warn' &&
          entry.message ===
            'Bootstrap request rejected (synchrony supports delivery bootstrap only)'
      )
    ).toBe(false);
  });

  it('ignores unresolved synchrony bootstrap requests when contracts are not resolved', async () => {
    const deliveryDocument = buildDeliveryDocument();

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
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-unresolved-sync',
          object: {
            sessionId: 'sync-session',
            document: buildSynchronyRequestingDocument(),
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'synchronyChannel',
                channelBindings: {
                  payNoteSender: { accountId: 'merchant-account' },
                  cardProcessorChannel: { accountId: 'processor-account' },
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
    expect(payNoteDeliveryRepository.saveDelivery).not.toHaveBeenCalled();
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
  });

  it('bootstraps delivery from the first synchrony request even when the requesting session is not canonical', async () => {
    bootstrapContextRepository.saveContext.mockClear();
    const deliveryDocument = withSynchronyMerchantSessionLink(
      buildDeliveryDocument(),
      'canonical-sync-session'
    );
    const enqueuePayNoteDeliverySummary = vi.fn().mockResolvedValue(undefined);

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { sessionId: 'bootstrap-session' },
      }),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-non-canonical-sync',
          object: {
            sessionId: 'shadow-sync-session',
            document: {
              contracts: {
                synchronyChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'bank-account',
                },
                sendPayNote: {
                  type: 'Conversation/Operation',
                },
                cardProcessorChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'processor-account',
                },
              },
            },
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'synchronyChannel',
                channelBindings: {
                  payNoteSender: { accountId: 'merchant-account' },
                  cardProcessorChannel: { accountId: 'processor-account' },
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
        enqueuePayNoteDeliverySummary,
        clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledTimes(1);
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: buildCardTransactionDetailsKey(cardDetails),
        synchronySessionId: 'canonical-sync-session',
      })
    );
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(
          'paynote-bootstrap:delivery-doc:stable:'
        ),
      })
    );
    expect(enqueuePayNoteDeliverySummary).not.toHaveBeenCalled();
    expect(bootstrapContextRepository.saveContext).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapSessionId: 'bootstrap-session',
        requestingSessionId: 'shadow-sync-session',
      })
    );
  });

  it('preserves schema-shaped delivery documents when bootstrapping synchrony requests', async () => {
    bootstrapContextRepository.saveContext.mockClear();
    const deliveryDocument = buildSchemaShapedDeliveryDocument();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { sessionId: 'bootstrap-session' },
      }),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-schema-sync',
          object: {
            sessionId: 'shadow-sync-session',
            document: {
              contracts: {
                synchronyChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'bank-account',
                },
                sendPayNote: {
                  type: 'Conversation/Operation',
                },
                cardProcessorChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'processor-account',
                },
              },
            },
            emitted: [
              {
                ...buildSchemaShapedDocumentBootstrapRequestedNode(),
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
        synchronySessionId: 'canonical-sync-session',
      })
    );
    const bootstrapPayload = myOsClient.bootstrapDocument.mock.calls[0]?.[0]
      ?.payload as
      | {
          document?: Record<string, unknown>;
        }
      | undefined;
    const bootstrappedDocument = bootstrapPayload?.document;
    expect(bootstrappedDocument).toBeTruthy();
    expect(bootstrappedDocument?.type).toEqual(
      expect.objectContaining({
        blueId: PAYNOTE_DELIVERY_BLUE_ID,
      })
    );
    expect(
      (
        (bootstrappedDocument?.contracts as Record<string, unknown> | undefined)
          ?.links as Record<string, unknown> | undefined
      )?.synchronyMerchantLink
    ).toEqual(
      expect.objectContaining({
        sessionId: expect.objectContaining({
          value: 'canonical-sync-session',
        }),
      })
    );
  });

  it('ignores duplicate synchrony bootstrap requests after delivery bootstrap is already known', async () => {
    bootstrapContextRepository.saveContext.mockClear();
    const deliveryDocument = withSynchronyMerchantSessionLink(
      buildDeliveryDocument(),
      'canonical-sync-session'
    );

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue({
        deliveryId: buildCardTransactionDetailsKey(cardDetails),
        deliverySessionId: 'delivery-session-bootstrapped',
        deliverySessionIds: ['delivery-session-bootstrapped'],
        synchronySessionId: 'canonical-sync-session',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-duplicate-sync-bootstrap',
          object: {
            sessionId: 'canonical-sync-session',
            document: buildSynchronyRequestingDocument(),
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'synchronyChannel',
                channelBindings: {
                  payNoteSender: { accountId: 'merchant-account' },
                  cardProcessorChannel: { accountId: 'processor-account' },
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
    expect(payNoteDeliveryRepository.saveDelivery).not.toHaveBeenCalled();
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(bootstrapContextRepository.saveContext).not.toHaveBeenCalled();
  });

  it(
    'attaches referenced payment mandate to bootstrapped paynote',
    async () => {
      const deliveryDocument =
        buildDeliveryDocumentWithPayNoteMandate('mandate-doc-1');

      const myOsClient = {
        getCredentials: vi.fn().mockResolvedValue({
          apiKey: 'api-key',
          accountId: 'bank-account',
          baseUrl: 'https://myos.example.com',
        }),
        bootstrapDocument: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          body: { sessionId: 'paynote-session-1' },
        }),
        runDocumentOperation: vi
          .fn()
          .mockResolvedValue({ ok: true, status: 200 }),
        fetchEvent: vi.fn(),
        fetchDocument: vi.fn().mockImplementation(async sessionId => {
          if (sessionId === 'mandate-session-1') {
            return {
              kind: 'success',
              document: {
                documentId: 'mandate-doc-1',
                sessionId: 'mandate-session-1',
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: 'merchant',
                  granterId: 'merchant-1',
                  granteeType: 'documentId',
                  granteeId: 'doc-1',
                  amountLimit: 5000,
                  currency: 'USD',
                },
              },
            } satisfies MyOsFetchDocumentResult;
          }

          return {
            kind: 'not-found',
            status: 404,
          } satisfies MyOsFetchDocumentResult;
        }),
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
        getDeliveryPollingMarkerByUserId: vi.fn(),
      };

      const contractRepository = {
        getContract: vi.fn(),
        getContractBySessionId: vi.fn(),
        getContractByDocumentId: vi
          .fn()
          .mockImplementation(async documentId => {
            if (documentId === 'mandate-doc-1') {
              return {
                contractId: 'mandate-contract-1',
                sessionId: 'mandate-session-1',
                documentId: 'mandate-doc-1',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
              };
            }
            return null;
          }),
        saveContract: vi.fn(),
      };

      const result = await handlePayNoteDeliveryWebhookEvent(
        {
          payload: {
            id: 'event-bootstrap-with-mandate',
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
                  document: {
                    type: 'PayNote/Card Transaction PayNote',
                    currency: 'USD',
                    amount: { total: 1200 },
                    paymentMandateDocumentId: 'mandate-doc-1',
                  },
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
      expect(myOsClient.bootstrapDocument).toHaveBeenCalledTimes(1);
      expect(contractRepository.getContractByDocumentId).toHaveBeenCalledWith(
        'mandate-doc-1'
      );

      const paynoteGuarantorUpdateCalls = getDocumentOperationCalls(
        myOsClient
      ).filter(
        call =>
          call.operation === 'guarantorUpdate' &&
          call.sessionId === 'paynote-session-1'
      );
      expect(paynoteGuarantorUpdateCalls).toHaveLength(1);
      const payload = JSON.stringify(paynoteGuarantorUpdateCalls[0]?.payload);
      expect(payload).toContain('PayNote/Payment Mandate Attached');
      expect(payload).toContain('mandate-doc-1');
    },
    CI_ONLY_SLOW_TEST_TIMEOUT_MS
  );

  it('rejects paynote bootstrap when referenced payment mandate cannot be resolved', async () => {
    const deliveryDocument = buildDeliveryDocumentWithPayNoteMandate(
      'missing-mandate-doc'
    );

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
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractBySessionId: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-with-missing-mandate',
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
                document: {
                  type: 'PayNote/Card Transaction PayNote',
                  currency: 'USD',
                  amount: { total: 1200 },
                  paymentMandateDocumentId: 'missing-mandate-doc',
                },
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
    expect(guarantorUpdateCall).toBeUndefined();
  });

  it('rejects paynote bootstrap when referenced payment mandate is revoked', async () => {
    const deliveryDocument = buildDeliveryDocumentWithPayNoteMandate(
      'revoked-mandate-doc'
    );

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
          documentId: 'revoked-mandate-doc',
          sessionId: 'revoked-mandate-session',
          document: {
            type: 'PayNote/Payment Mandate',
            granterType: 'merchant',
            granterId: 'merchant-1',
            granteeType: 'documentId',
            granteeId: 'doc-1',
            amountLimit: 5000,
            currency: 'USD',
            revokedAt: '2024-01-01T00:00:00.000Z',
          },
        },
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractBySessionId: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue({
        contractId: 'revoked-mandate-contract',
        sessionId: 'revoked-mandate-session',
        documentId: 'revoked-mandate-doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-with-revoked-mandate',
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
                document: {
                  type: 'PayNote/Card Transaction PayNote',
                  currency: 'USD',
                  amount: { total: 1200 },
                  paymentMandateDocumentId: 'revoked-mandate-doc',
                },
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
        clock: { now: () => new Date('2024-01-02T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeUndefined();
  });

  it('rejects paynote bootstrap when referenced payment mandate is expired', async () => {
    const deliveryDocument = buildDeliveryDocumentWithPayNoteMandate(
      'expired-mandate-doc'
    );

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
          documentId: 'expired-mandate-doc',
          sessionId: 'expired-mandate-session',
          document: {
            type: 'PayNote/Payment Mandate',
            granterType: 'merchant',
            granterId: 'merchant-1',
            granteeType: 'documentId',
            granteeId: 'doc-1',
            amountLimit: 5000,
            currency: 'USD',
            expiresAt: '2023-12-31T23:59:59.000Z',
          },
        },
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractBySessionId: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue({
        contractId: 'expired-mandate-contract',
        sessionId: 'expired-mandate-session',
        documentId: 'expired-mandate-doc',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-with-expired-mandate',
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
                document: {
                  type: 'PayNote/Card Transaction PayNote',
                  currency: 'USD',
                  amount: { total: 1200 },
                  paymentMandateDocumentId: 'expired-mandate-doc',
                },
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
        clock: { now: () => new Date('2024-01-02T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeUndefined();
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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
                cardProcessorChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'processor-account',
                },
              },
            },
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'synchronyChannel',
                channelBindings: {
                  payNoteSender: { accountId: 'merchant-account' },
                  cardProcessorChannel: { accountId: 'processor-account' },
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
    expect(guarantorUpdatePayloads).toHaveLength(0);
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledTimes(1);
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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
      customerChannelKey: 'payerChannel',
      requestingSessionId: 'active-paynote-session-1',
      createdAt: '2024-01-10T00:00:00.000Z',
    });
  });

  it('rejects non-card-transaction paynote bootstrap from delivery-origin request', async () => {
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();
    bootstrapContextRepository.saveContext.mockClear();

    const deliveryDocument = {
      ...buildDeliveryDocument(),
      contracts: {
        ...(buildDeliveryDocument().contracts as Record<string, unknown>),
        payerChannel: {
          type: 'MyOS/MyOS Timeline Channel',
          accountId: 'customer-account-id',
        },
        payeeChannel: {
          type: 'MyOS/MyOS Timeline Channel',
          accountId: 'merchant-account-id',
        },
      },
    } as Record<string, unknown>;

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { sessionId: 'voucher-session-from-delivery' },
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-paynote-counter-from-delivery',
          object: {
            sessionId: 'delivery-session-1',
            document: deliveryDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
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
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(bootstrapContextRepository.saveContext).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeUndefined();
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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

  it('does not bootstrap a second paynote when delivery already has a linked paynote document', async () => {
    const now = '2024-01-10T00:00:00.000Z';
    const deliveryDocument = buildDeliveryDocument();
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();
    bootstrapContextRepository.saveContext.mockClear();

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
      getDelivery: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '9559276001',
        userId: 'customer-user-1',
        merchantId: 'merchant-1',
        holdId: 'hold-1',
        payNoteDocumentId: 'existing-paynote-doc-1',
        payNoteBootstrapSessionId: 'existing-bootstrap-session-1',
        createdAt: now,
        updatedAt: now,
      }),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-duplicate-paynote-bootstrap-from-delivery',
          object: {
            sessionId: 'delivery-session-1',
            document: deliveryDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
                requestId: 'duplicate-root-paynote-bootstrap',
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
        holdRepository: {
          getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
          getHold: vi.fn().mockResolvedValue(null),
        } as any,
        bootstrapContextRepository,
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(bootstrapContextRepository.saveContext).not.toHaveBeenCalled();
    expect(getOperationCall(myOsClient, 'guarantorUpdate')).toBeUndefined();
  });

  it('does not re-answer paynote bootstrap when bootstrap is already in progress', async () => {
    const now = '2024-01-10T00:00:00.000Z';
    const deliveryDocument = buildDeliveryDocument();
    const counterPayNoteDocument = buildPayNoteWithCounterDocument();
    bootstrapContextRepository.saveContext.mockClear();

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
      getDelivery: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '9559276001',
        userId: 'customer-user-1',
        merchantId: 'merchant-1',
        holdId: 'hold-1',
        payNoteBootstrapSessionId: 'existing-bootstrap-session-1',
        createdAt: now,
        updatedAt: now,
      }),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-paynote-bootstrap-already-in-progress',
          object: {
            sessionId: 'delivery-session-1',
            document: deliveryDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
                requestId: 'root-paynote-bootstrap-in-progress',
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
        holdRepository: {
          getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
          getHold: vi.fn().mockResolvedValue(null),
        } as any,
        bootstrapContextRepository,
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(bootstrapContextRepository.saveContext).not.toHaveBeenCalled();
    expect(getOperationCall(myOsClient, 'guarantorUpdate')).toBeUndefined();
  });

  it('stores customer channel key from the matched requesting participant binding', async () => {
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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

  it('rejects active bootstrap when payerAccountNumber/payeeAccountNumber are provided explicitly', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const counterPayNoteDocument = {
      ...buildPayNoteWithCounterDocument(),
      payerAccountNumber: '1111111111',
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

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-explicit-accounts',
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
          getDeliveryPollingMarkerByUserId: vi.fn(),
        } as any,
        contractRepository: {
          getContract: vi.fn(),
          getContractByDocumentId: vi.fn(),
          getContractBySessionId: vi.fn().mockResolvedValue({
            documentId: 'active-paynote-doc-1',
          }),
          saveContract: vi.fn(),
        } as any,
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
      'payerAccountNumber/payeeAccountNumber are not supported for bootstrap from active PayNotes.'
    );
  });

  it('stores merchant credit-line payer and root customer payee for merchant-to-customer bootstrap', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const merchantToCustomerDocument = buildMerchantToCustomerPayNoteDocument();
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
        body: { sessionId: 'voucher-session-m2c' },
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
          id: 'event-bootstrap-m2c-routing',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'merchant-account-id' },
                  payeeChannel: { accountId: 'customer-account-id' },
                },
                document: merchantToCustomerDocument,
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
          getDeliveryPollingMarkerByUserId: vi.fn(),
        } as any,
        contractRepository: {
          getContract: vi.fn(),
          getContractByDocumentId: vi.fn(),
          getContractBySessionId: vi.fn().mockResolvedValue({
            documentId: 'active-paynote-doc-1',
          }),
          saveContract: vi.fn(),
        } as any,
        bankingRepository: {
          getAccountsByUserId: vi.fn().mockResolvedValue([
            {
              accountType: 'DEPOSIT',
              accountNumber: '3000000000',
              status: 'ACTIVE',
            },
            {
              accountType: 'CREDIT_LINE',
              accountNumber: '7000000001',
              status: 'ACTIVE',
            },
          ]),
        } as any,
        resolveMerchantOwnerUserId: vi
          .fn()
          .mockResolvedValue('merchant-user-1'),
        holdRepository: {} as any,
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledTimes(1);
    expect(bootstrapContextRepository.saveContext).toHaveBeenCalledWith({
      bootstrapSessionId: 'voucher-session-m2c',
      merchantId: 'merchant-1',
      accountNumber: '9559276001',
      userId: 'customer-user-1',
      payerAccountNumber: '7000000001',
      payeeAccountNumber: '9559276001',
      customerChannelKey: 'payeeChannel',
      requestingSessionId: 'active-paynote-session-1',
      createdAt: '2024-01-10T00:00:00.000Z',
    });
  });

  it('rejects merchant-to-customer bootstrap when merchant has no active credit-line account', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const merchantToCustomerDocument = buildMerchantToCustomerPayNoteDocument();
    bootstrapContextRepository.saveContext.mockClear();

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

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-m2c-no-active-credit-line',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'merchant-account-id' },
                  payeeChannel: { accountId: 'customer-account-id' },
                },
                document: merchantToCustomerDocument,
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
          getDeliveryPollingMarkerByUserId: vi.fn(),
        } as any,
        contractRepository: {
          getContract: vi.fn(),
          getContractByDocumentId: vi.fn(),
          getContractBySessionId: vi.fn().mockResolvedValue({
            documentId: 'active-paynote-doc-1',
          }),
          saveContract: vi.fn(),
        } as any,
        bankingRepository: {
          getAccountsByUserId: vi.fn().mockResolvedValue([
            {
              accountType: 'DEPOSIT',
              accountNumber: '3000000000',
              status: 'ACTIVE',
            },
          ]),
        } as any,
        resolveMerchantOwnerUserId: vi
          .fn()
          .mockResolvedValue('merchant-user-1'),
        holdRepository: {} as any,
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(bootstrapContextRepository.saveContext).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeDefined();
    const payload = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
    expect(payload).toContain(
      'Unable to resolve merchant credit line account for Merchant To Customer PayNote bootstrap.'
    );
  });

  it('rejects merchant-to-customer bootstrap when merchant credit-line is not active', async () => {
    const activePayNoteDocument = buildActivePayNoteDocument();
    const merchantToCustomerDocument = buildMerchantToCustomerPayNoteDocument();
    bootstrapContextRepository.saveContext.mockClear();

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

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-m2c-closed-credit-line',
          object: {
            sessionId: 'active-paynote-session-1',
            document: activePayNoteDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                channelBindings: {
                  payerChannel: { accountId: 'merchant-account-id' },
                  payeeChannel: { accountId: 'customer-account-id' },
                },
                document: merchantToCustomerDocument,
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
          getDeliveryPollingMarkerByUserId: vi.fn(),
        } as any,
        contractRepository: {
          getContract: vi.fn(),
          getContractByDocumentId: vi.fn(),
          getContractBySessionId: vi.fn().mockResolvedValue({
            documentId: 'active-paynote-doc-1',
          }),
          saveContract: vi.fn(),
        } as any,
        bankingRepository: {
          getAccountsByUserId: vi.fn().mockResolvedValue([
            {
              accountType: 'CREDIT_LINE',
              accountNumber: '7000000001',
              status: 'CLOSED',
            },
          ]),
        } as any,
        resolveMerchantOwnerUserId: vi
          .fn()
          .mockResolvedValue('merchant-user-1'),
        holdRepository: {} as any,
        bootstrapContextRepository,
        clock: { now: () => new Date('2024-01-10T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(bootstrapContextRepository.saveContext).not.toHaveBeenCalled();
    const guarantorUpdateCall = getOperationCall(myOsClient, 'guarantorUpdate');
    expect(guarantorUpdateCall).toBeDefined();
    const payload = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
    expect(payload).toContain(
      'Unable to resolve merchant credit line account for Merchant To Customer PayNote bootstrap.'
    );
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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
      customerChannelKey: 'payerChannel',
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
          getDeliveryPollingMarkerByUserId: vi.fn(),
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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

  it('bootstraps active paynote request when canonical contract is resolved via webhook object blueId', async () => {
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi
        .fn()
        .mockResolvedValue({ documentId: 'active-paynote-doc-1' }),
      getContractBySessionId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-bootstrap-paynote-via-blueid',
          object: {
            sessionId: 'active-paynote-session-shadow',
            blueId: 'active-paynote-doc-1',
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
      'active-paynote-session-shadow'
    );
    expect(contractRepository.getContractByDocumentId).toHaveBeenCalledWith(
      'active-paynote-doc-1'
    );
    expect(myOsClient.fetchDocument).not.toHaveBeenCalled();
    expect(
      payNoteDeliveryRepository.getDeliveryByPayNoteDocumentId
    ).toHaveBeenCalledWith('active-paynote-doc-1');
    expect(myOsClient.bootstrapDocument).toHaveBeenCalled();
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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
    expect(guarantorUpdateCall).toBeUndefined();
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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
    expect(guarantorUpdateCall).toBeUndefined();
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
          getDeliveryPollingMarkerByUserId: vi.fn(),
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
    expect(guarantorUpdateCall).toBeUndefined();
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
          getDeliveryPollingMarkerByUserId: vi.fn(),
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
    expect(guarantorUpdateCall).toBeUndefined();
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
          getDeliveryPollingMarkerByUserId: vi.fn(),
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
    expect(guarantorUpdateCall).toBeUndefined();
  });

  it('reports delivery errors when paynote payer channel conflicts with bank account', async () => {
    const deliveryDocument = buildDeliveryDocument();
    const payNoteDocument = {
      type: 'PayNote/Card Transaction PayNote',
      currency: 'USD',
      amount: { total: 1200 },
      contracts: {
        payerChannel: {
          type: 'MyOS/MyOS Timeline Channel',
          accountId: 'other-payer',
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
          id: 'event-payer-conflict',
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
          getDeliveryPollingMarkerByUserId: vi.fn(),
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
    expect(guarantorUpdateCall).toBeUndefined();
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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

  it('skips idempotency claim when explicitly requested', async () => {
    const deliveryDocument = buildDeliveryDocument();

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
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
    };
    const holdRepository = {
      getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        skipEventIdempotencyClaim: true,
        payload: {
          id: 'event-skip-claim',
          type: 'DOCUMENT_EPOCH_ADVANCED',
          object: {
            sessionId: 'sync-session',
            document: deliveryDocument,
            emitted: [],
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
        clock: { now: () => new Date('2024-01-04T00:00:00.000Z') },
      }
    );

    expect(result.handled).toBe(true);
    expect(payNoteDeliveryRepository.markEventProcessed).not.toHaveBeenCalled();
    expect(
      payNoteDeliveryRepository.finalizeEventProcessing
    ).not.toHaveBeenCalled();
    expect(
      payNoteDeliveryRepository.releaseEventProcessing
    ).not.toHaveBeenCalled();
  });

  it('releases event claim when delivery processing fails', async () => {
    const deliveryDocument = buildDeliveryDocument();

    const myOsClient = {
      getCredentials: vi.fn().mockRejectedValue(new Error('credentials-error')),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
      saveDelivery: vi.fn(),
      getDelivery: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      saveContract: vi.fn(),
    };

    await expect(
      handlePayNoteDeliveryWebhookEvent(
        {
          payload: {
            id: 'event-release-1',
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
      )
    ).rejects.toThrow('credentials-error');

    expect(
      payNoteDeliveryRepository.releaseEventProcessing
    ).toHaveBeenCalledWith('event-release-1');
    expect(
      payNoteDeliveryRepository.finalizeEventProcessing
    ).not.toHaveBeenCalled();
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
      getDeliveryPollingMarkerByUserId: vi.fn(),
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
                cardProcessorChannel: {
                  type: 'MyOS/MyOS Timeline Channel',
                  accountId: 'processor-account',
                },
              },
            },
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'synchronyChannel',
                channelBindings: {
                  payNoteSender: { accountId: 'merchant-account' },
                  cardProcessorChannel: { accountId: 'processor-account' },
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

  it('records pending action for customer payment mandate bootstrap request', async () => {
    const now = '2024-01-06T10:00:00.000Z';
    const requestingDocument = buildActivePayNoteDocument();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-1',
        merchantId: 'merchant-1',
        createdAt: now,
        updatedAt: now,
      }),
      saveDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      getDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi.fn().mockResolvedValue({
        contractId: 'contract-1',
        typeBlueId: 'type-1',
        displayName: 'Card Transaction PayNote',
        sessionId: 'paynote-session-1',
        documentId: 'paynote-doc-1',
        userId: 'user-1',
        customerChannelKey: 'payerChannel',
        pendingActions: [],
        createdAt: now,
        updatedAt: now,
      }),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-mandate-bootstrap-1',
          object: {
            sessionId: 'paynote-session-1',
            document: requestingDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                requestId: 'subscription-payment-mandate',
                initialMessages: {
                  perChannel: {
                    granterChannel:
                      'Authorize recurring monthly payments for this contract (customer message).',
                    payerChannel:
                      'Authorize recurring monthly payments for this contract (payer fallback).',
                  },
                  defaultMessage: 'Default payment mandate message.',
                },
                channelBindings: {
                  granterChannel: { accountId: 'user-1' },
                  granteeChannel: { accountId: 'merchant-1' },
                },
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: 'customer',
                  granterId: 'user-1',
                  granteeType: 'documentId',
                  granteeId: 'paynote-doc-1',
                  amountLimit: 12000,
                  currency: 'USD',
                  sourceAccount: 'root',
                  allowedPaymentCounterparties: [
                    {
                      counterpartyType: 'merchantId',
                      counterpartyId: 'merchant-allowed-1',
                    },
                    {
                      counterpartyType: 'customerId',
                      counterpartyId: 'customer-allowed-1',
                    },
                  ],
                  expiresAt: '2027-12-31T23:59:59.000Z',
                },
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
        resolveMerchantNameById: vi
          .fn()
          .mockImplementation(async (merchantId: string) =>
            merchantId === 'merchant-allowed-1' ? 'Shop 2' : undefined
          ),
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(contractRepository.saveContract).toHaveBeenCalledTimes(1);
    const savedContract = (
      contractRepository.saveContract as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    const savedAction = savedContract.pendingActions?.[0];
    expect(savedAction).toEqual(
      expect.objectContaining({
        type: 'paymentMandateBootstrapApproval',
        status: 'pending',
        requestId: 'subscription-payment-mandate',
        title: 'Authorize automated payments',
      })
    );
    expect(savedAction?.summary).toContain(
      'Authorize recurring monthly payments for this contract (customer message).'
    );
    expect(savedAction?.summary).not.toContain(
      'Authorize recurring monthly payments for this contract (payer fallback).'
    );
    expect(savedAction?.summary).toContain('Paid to Shop 2.');
    expect(savedAction?.summary).toContain(
      'Valid until December 31, 2027, and can be revoked anytime.'
    );
    expect(savedAction?.summary).toContain('\n\n');
    expect(contractRepository.addContractHistoryEntry).not.toHaveBeenCalled();
  });

  it('records pending action for customer payment mandate bootstrap request from alternate session of the same paynote document', async () => {
    const now = '2024-01-06T10:02:00.000Z';
    const requestingDocument = buildActivePayNoteDocument();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn().mockResolvedValue({
        kind: 'success',
        document: {
          documentId: 'paynote-doc-1',
          sessionId: 'paynote-shadow-session-1',
          document: requestingDocument,
        },
      } satisfies MyOsFetchDocumentResult),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-1',
        merchantId: 'merchant-1',
        createdAt: now,
        updatedAt: now,
      }),
      saveDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      getDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };

    const canonicalContract = {
      contractId: 'contract-1',
      typeBlueId: 'type-1',
      displayName: 'Card Transaction PayNote',
      sessionId: 'paynote-session-1',
      documentId: 'paynote-doc-1',
      userId: 'user-1',
      customerChannelKey: 'payerChannel',
      pendingActions: [],
      createdAt: now,
      updatedAt: now,
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(canonicalContract),
      getContractBySessionId: vi
        .fn()
        .mockImplementation(async (sessionId: string) =>
          sessionId === 'paynote-session-1' ? canonicalContract : null
        ),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-mandate-bootstrap-shadow-session',
          object: {
            sessionId: 'paynote-shadow-session-1',
            document: requestingDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                requestId: 'subscription-payment-mandate',
                initialMessages: {
                  perChannel: {
                    granterChannel:
                      'Authorize recurring monthly payments for this contract (customer message).',
                  },
                  defaultMessage: 'Default payment mandate message.',
                },
                channelBindings: {
                  granterChannel: { accountId: 'user-1' },
                  granteeChannel: { accountId: 'merchant-1' },
                },
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: 'customer',
                  granterId: 'user-1',
                  granteeType: 'documentId',
                  granteeId: 'paynote-doc-1',
                  amountLimit: 12000,
                  currency: 'USD',
                  sourceAccount: 'root',
                },
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
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.fetchDocument).toHaveBeenCalledWith(
      'paynote-shadow-session-1'
    );
    expect(contractRepository.getContractByDocumentId).toHaveBeenCalledWith(
      'paynote-doc-1'
    );
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            type: 'paymentMandateBootstrapApproval',
            status: 'pending',
            requestId: 'subscription-payment-mandate',
          }),
        ]),
      })
    );
  });

  it('records pending action for alternate paynote session using initialized document id from webhook payload', async () => {
    const now = '2024-01-06T10:02:30.000Z';
    const requestingDocument = {
      ...buildActivePayNoteDocument(),
      initialized: {
        documentId: {
          value: 'paynote-doc-1',
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
      fetchDocument: vi
        .fn()
        .mockRejectedValue(new Error('fetchDocument should not run')),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-1',
        merchantId: 'merchant-1',
        createdAt: now,
        updatedAt: now,
      }),
      saveDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      getDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };

    const canonicalContract = {
      contractId: 'contract-1',
      typeBlueId: 'type-1',
      displayName: 'Card Transaction PayNote',
      sessionId: 'paynote-session-1',
      documentId: 'paynote-doc-1',
      userId: 'user-1',
      customerChannelKey: 'payerChannel',
      pendingActions: [],
      createdAt: now,
      updatedAt: now,
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(canonicalContract),
      getContractBySessionId: vi
        .fn()
        .mockImplementation(async (sessionId: string) =>
          sessionId === 'paynote-session-1' ? canonicalContract : null
        ),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-mandate-bootstrap-shadow-session-payload-doc-id',
          object: {
            sessionId: 'paynote-shadow-session-1',
            document: requestingDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                requestId: 'subscription-payment-mandate',
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: 'customer',
                  granterId: 'user-1',
                  granteeType: 'documentId',
                  granteeId: 'paynote-doc-1',
                  amountLimit: 12000,
                  currency: 'USD',
                  sourceAccount: 'root',
                },
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
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.fetchDocument).not.toHaveBeenCalled();
    expect(contractRepository.getContractByDocumentId).toHaveBeenCalledWith(
      'paynote-doc-1'
    );
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            type: 'paymentMandateBootstrapApproval',
            status: 'pending',
            requestId: 'subscription-payment-mandate',
          }),
        ]),
      })
    );
  });

  it('deduplicates payment mandate bootstrap pending action by requestId across paynote shadow sessions', async () => {
    const now = '2024-01-06T10:03:00.000Z';
    const requestingDocument = buildActivePayNoteDocument();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn().mockResolvedValue({
        kind: 'success',
        document: {
          documentId: 'paynote-doc-1',
          sessionId: 'paynote-shadow-session-1',
          document: requestingDocument,
        },
      } satisfies MyOsFetchDocumentResult),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-1',
        merchantId: 'merchant-1',
        createdAt: now,
        updatedAt: now,
      }),
      saveDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      getDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };

    const canonicalContract = {
      contractId: 'contract-1',
      typeBlueId: 'type-1',
      displayName: 'Card Transaction PayNote',
      sessionId: 'paynote-session-1',
      documentId: 'paynote-doc-1',
      userId: 'user-1',
      customerChannelKey: 'payerChannel',
      pendingActions: [
        {
          actionId: 'payment-mandate-bootstrap:event-canonical:0',
          type: 'paymentMandateBootstrapApproval',
          status: 'pending',
          title: 'Authorize automated payments',
          requestId: 'subscription-payment-mandate',
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn().mockResolvedValue(canonicalContract),
      getContractBySessionId: vi
        .fn()
        .mockImplementation(async (sessionId: string) =>
          sessionId === 'paynote-session-1' ? canonicalContract : null
        ),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-shadow-duplicate-request-id',
          object: {
            sessionId: 'paynote-shadow-session-1',
            document: requestingDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                requestId: 'subscription-payment-mandate',
                channelBindings: {
                  granterChannel: { accountId: 'user-1' },
                  granteeChannel: { accountId: 'merchant-1' },
                },
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: 'customer',
                  granterId: 'user-1',
                  granteeType: 'documentId',
                  granteeId: 'paynote-doc-1',
                  amountLimit: 12000,
                  currency: 'USD',
                  sourceAccount: 'root',
                },
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
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(contractRepository.saveContract).not.toHaveBeenCalled();
  });

  it('records pending action when mandate granterType is provided as typed scalar node', async () => {
    const now = '2024-01-06T10:05:00.000Z';
    const requestingDocument = buildActivePayNoteDocument();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn(),
      runDocumentOperation: vi.fn(),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-1',
        merchantId: 'merchant-1',
        createdAt: now,
        updatedAt: now,
      }),
      saveDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      getDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi.fn().mockResolvedValue({
        contractId: 'contract-1',
        typeBlueId: 'type-1',
        displayName: 'Card Transaction PayNote',
        sessionId: 'paynote-session-1',
        documentId: 'paynote-doc-1',
        userId: 'user-1',
        pendingActions: [],
        createdAt: now,
        updatedAt: now,
      }),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-mandate-bootstrap-typed-granter',
          object: {
            sessionId: 'paynote-session-1',
            document: requestingDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                requestId: 'subscription-payment-mandate',
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: {
                    type: 'Text',
                    value: 'customer',
                  },
                  granterId: 'user-1',
                  granteeType: 'documentId',
                  granteeId: 'paynote-doc-1',
                  amountLimit: 12000,
                  currency: 'USD',
                  sourceAccount: 'root',
                },
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
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            type: 'paymentMandateBootstrapApproval',
            status: 'pending',
            requestId: 'subscription-payment-mandate',
            title: 'Authorize automated payments',
          }),
        ]),
      })
    );
    const savedContract = (
      contractRepository.saveContract as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    const savedAction = savedContract.pendingActions?.[0];
    expect(savedAction?.summary).toContain(
      'Paid to the merchant specified in this contract.'
    );
    expect(savedAction?.summary).toContain('Can be revoked anytime.');
    expect(myOsClient.runDocumentOperation).not.toHaveBeenCalled();
  });

  it('rejects customer payment mandate bootstrap when contract cannot be loaded for pending action queueing', async () => {
    const now = '2024-01-06T10:30:00.000Z';
    const requestingDocument = buildActivePayNoteDocument();

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
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-1',
        merchantId: 'merchant-1',
        createdAt: now,
        updatedAt: now,
      }),
      saveDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      getDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi
        .fn()
        .mockResolvedValueOnce({
          contractId: 'contract-1',
          typeBlueId: 'type-1',
          displayName: 'Card Transaction PayNote',
          sessionId: 'paynote-session-1',
          documentId: 'paynote-doc-1',
          userId: 'user-1',
          pendingActions: [],
          createdAt: now,
          updatedAt: now,
        })
        .mockResolvedValueOnce(null),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-mandate-bootstrap-missing-session',
          object: {
            sessionId: 'paynote-session-1',
            document: requestingDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                requestId: 'subscription-payment-mandate',
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: 'customer',
                  granterId: 'user-1',
                  granteeType: 'documentId',
                  granteeId: 'paynote-doc-1',
                  amountLimit: 12000,
                  currency: 'USD',
                  sourceAccount: 'root',
                },
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
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(contractRepository.saveContract).not.toHaveBeenCalled();
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    const payload = JSON.stringify(
      getOperationCall(myOsClient as any, 'guarantorUpdate')?.payload
    );
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
    expect(payload).toContain(
      'Unable to resolve requesting contract session for payment mandate bootstrap.'
    );
  });

  it('rejects non-customer payment mandate bootstrap requests', async () => {
    const now = '2024-01-06T11:00:00.000Z';
    const requestingDocument = buildActivePayNoteDocument();

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
      fetchDocument: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-1',
        merchantId: 'merchant-1',
        createdAt: now,
        updatedAt: now,
      }),
      saveDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      getDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi.fn().mockResolvedValue({
        contractId: 'contract-1',
        typeBlueId: 'type-1',
        displayName: 'Card Transaction PayNote',
        sessionId: 'paynote-session-1',
        documentId: 'paynote-doc-1',
        userId: 'user-1',
        pendingActions: [],
        createdAt: now,
        updatedAt: now,
      }),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-mandate-bootstrap-merchant-1',
          object: {
            sessionId: 'paynote-session-1',
            document: requestingDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'guarantorChannel',
                requestId: 'merchant-payment-mandate',
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: 'merchant',
                  granterId: 'merchant-1',
                  granteeType: 'documentId',
                  granteeId: 'paynote-doc-1',
                  amountLimit: 12000,
                  currency: 'USD',
                  sourceAccount: 'root',
                },
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
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(contractRepository.saveContract).not.toHaveBeenCalled();
    expect(myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'paynote-session-1',
        operation: 'guarantorUpdate',
      })
    );
    const payload = JSON.stringify(
      getOperationCall(myOsClient as any, 'guarantorUpdate')?.payload
    );
    expect(payload).toContain('Conversation/Document Bootstrap Responded');
    expect(payload).toContain('rejected');
  });

  it('bootstraps merchant payment mandate requests from delivery documents', async () => {
    const now = '2024-01-06T12:00:00.000Z';
    const requestingDocument = buildDeliveryDocument();

    const myOsClient = {
      getCredentials: vi.fn().mockResolvedValue({
        apiKey: 'api-key',
        accountId: 'bank-account',
        baseUrl: 'https://myos.example.com',
      }),
      bootstrapDocument: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { sessionId: 'mandate-bootstrap-session-1' },
      }),
      runDocumentOperation: vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200 }),
      fetchEvent: vi.fn(),
      fetchDocument: vi.fn().mockResolvedValue({
        kind: 'success',
        document: {
          documentId: 'delivery-doc-1',
          sessionId: 'delivery-session-1',
          document: requestingDocument,
        },
      } as MyOsFetchDocumentResult),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue(null),
      getDeliveryBySessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByCardTransactionDetails: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn().mockResolvedValue(null),
      getDelivery: vi.fn().mockResolvedValue(null),
      saveDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn().mockResolvedValue([]),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi.fn(),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
    };

    const holdRepository = {
      getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
      getHold: vi.fn().mockResolvedValue(null),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-delivery-merchant-mandate-bootstrap',
          object: {
            sessionId: 'delivery-session-1',
            document: requestingDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
                requestId: 'delivery-merchant-mandate-bootstrap',
                channelBindings: {
                  granterChannel: { accountId: 'merchant-account' },
                  granteeChannel: { accountId: 'customer-account' },
                },
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: 'merchant',
                  granterId: 'merchant-account',
                  granteeType: 'merchantId',
                  granteeId: 'merchant-account',
                  amountLimit: 12000,
                  currency: 'USD',
                  sourceAccount: 'root',
                  contracts: {
                    granterChannel: {
                      type: 'MyOS/MyOS Timeline Channel',
                    },
                    granteeChannel: {
                      type: 'MyOS/MyOS Timeline Channel',
                    },
                    guarantorChannel: {
                      type: 'MyOS/MyOS Timeline Channel',
                    },
                  },
                },
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
        holdRepository: holdRepository as any,
        bootstrapContextRepository,
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          document: expect.objectContaining({
            type: 'PayNote/Payment Mandate',
          }),
          channelBindings: expect.objectContaining({
            granterChannel: { accountId: 'merchant-account' },
            granteeChannel: { accountId: 'customer-account' },
            guarantorChannel: { accountId: 'bank-account' },
          }),
        }),
      })
    );
    expect(bootstrapContextRepository.saveContext).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapSessionId: 'mandate-bootstrap-session-1',
        requestingSessionId: 'delivery-session-1',
        requestId: 'delivery-merchant-mandate-bootstrap',
      })
    );
    expect(
      getOperationCall(myOsClient as any, 'guarantorUpdate')
    ).toBeUndefined();
  });

  it('ignores merchant payment mandate bootstrap requests from non-canonical delivery sessions', async () => {
    const now = '2024-01-06T12:30:00.000Z';
    const requestingDocument = buildDeliveryDocument();
    bootstrapContextRepository.saveContext.mockClear();
    bootstrapContextRepository.getContextBySessionId.mockClear();

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
          sessionId: 'delivery-session-shadow',
          document: requestingDocument,
        },
      } as MyOsFetchDocumentResult),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn().mockResolvedValue(true),
      getDeliveryByPayNoteDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        deliveryDocumentId: 'delivery-doc-1',
        deliverySessionId: 'delivery-session-1',
        createdAt: now,
        updatedAt: now,
      }),
      getDeliveryBySessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByBootstrapSessionId: vi.fn().mockResolvedValue(null),
      getDeliveryByCardTransactionDetails: vi.fn().mockResolvedValue(null),
      getDeliveryByDocumentId: vi.fn().mockResolvedValue({
        deliveryId: 'delivery-1',
        deliveryDocumentId: 'delivery-doc-1',
        deliverySessionId: 'delivery-session-1',
        createdAt: now,
        updatedAt: now,
      }),
      getDelivery: vi.fn().mockResolvedValue(null),
      saveDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn().mockResolvedValue([]),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi.fn().mockResolvedValue({
        documentId: 'delivery-doc-1',
      }),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
    };

    const holdRepository = {
      getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
      getHold: vi.fn().mockResolvedValue(null),
    };

    const result = await handlePayNoteDeliveryWebhookEvent(
      {
        payload: {
          id: 'event-delivery-merchant-mandate-bootstrap-shadow',
          object: {
            sessionId: 'delivery-session-shadow',
            document: requestingDocument,
            emitted: [
              {
                type: 'Conversation/Document Bootstrap Requested',
                bootstrapAssignee: 'payNoteDeliverer',
                requestId: 'delivery-merchant-mandate-bootstrap',
                channelBindings: {
                  granterChannel: { accountId: 'merchant-account' },
                  granteeChannel: { accountId: 'customer-account' },
                },
                document: {
                  type: 'PayNote/Payment Mandate',
                  granterType: 'merchant',
                  granterId: 'merchant-account',
                  granteeType: 'merchantId',
                  granteeId: 'merchant-account',
                  amountLimit: 12000,
                  currency: 'USD',
                  sourceAccount: 'root',
                  contracts: {
                    granterChannel: {
                      type: 'MyOS/MyOS Timeline Channel',
                    },
                    granteeChannel: {
                      type: 'MyOS/MyOS Timeline Channel',
                    },
                    guarantorChannel: {
                      type: 'MyOS/MyOS Timeline Channel',
                    },
                  },
                },
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
        holdRepository: holdRepository as any,
        bootstrapContextRepository,
        clock: { now: () => new Date(now) },
      }
    );

    expect(result.handled).toBe(true);
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
    expect(bootstrapContextRepository.saveContext).not.toHaveBeenCalled();
    expect(
      getOperationCall(myOsClient as any, 'guarantorUpdate')
    ).toBeUndefined();
    expect(
      result.logs.some(
        entry =>
          entry.message ===
          'Bootstrap requests ignored (non-canonical delivery session)'
      )
    ).toBe(true);
  });
});
