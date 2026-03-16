import { describe, it, expect, beforeEach, vi } from 'vitest';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import myosBlueIds from '@blue-repository/types/packages/myos/blue-ids';
import { PAYNOTE_DELIVERY_BLUE_ID } from '@demo-bank-app/paynotes';
import { payNoteWebhookHandler } from './webhook';
import {
  buildSchemaShapedDocumentBootstrapRequestedEvent,
  buildSchemaShapedDocumentBootstrapRequestedNode,
  buildSynchronyDocumentWithCheckpointBootstrapRequest,
} from './testFixtures';

const hoistedDeps = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  createResolveMerchantOwnerUserIdMock: vi.fn(),
  createResolveMerchantNameByIdMock: vi.fn(),
}));

const hoistedPaynotes = vi.hoisted(() => ({
  handlePayNoteDeliveryWebhookEventMock: vi.fn(),
  handlePayNoteBootstrapWebhookEventMock: vi.fn(),
  handleWebhookEventMock: vi.fn(),
  consumePendingPayNoteBootstrapEventsMock: vi.fn(),
}));

const hoistedRepositories = vi.hoisted(() => ({
  contractRepository: null as any,
  summaryInputStore: null as any,
  bootstrapContextRepository: null as any,
  payNoteDeliveryRepository: null as any,
}));

const hoistedAdapters = vi.hoisted(() => ({
  fetchEventImpl: vi.fn(),
  fetchDocumentImpl: vi.fn(),
  getAccountByNumberImpl: vi.fn(),
  getPayNoteBySessionIdImpl: vi.fn(),
  transferFundsMock: vi.fn(),
  reserveFundsMock: vi.fn(),
  captureHoldMock: vi.fn(),
}));

vi.mock('./dependencies', () => ({
  getDependencies: hoistedDeps.getDependenciesMock,
  createResolveMerchantOwnerUserId:
    hoistedDeps.createResolveMerchantOwnerUserIdMock,
  createResolveMerchantNameById: hoistedDeps.createResolveMerchantNameByIdMock,
}));

vi.mock('@demo-bank-app/paynotes', async () => {
  const actual = await vi.importActual<
    typeof import('@demo-bank-app/paynotes')
  >('@demo-bank-app/paynotes');
  hoistedPaynotes.handlePayNoteBootstrapWebhookEventMock = vi.fn(
    actual.handlePayNoteBootstrapWebhookEvent
  );
  hoistedPaynotes.handleWebhookEventMock = vi.fn(actual.handleWebhookEvent);
  hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock = vi.fn(
    actual.consumePendingPayNoteBootstrapEvents
  );
  return {
    ...actual,
    handlePayNoteDeliveryWebhookEvent:
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock,
    handlePayNoteBootstrapWebhookEvent:
      hoistedPaynotes.handlePayNoteBootstrapWebhookEventMock,
    handleWebhookEvent: hoistedPaynotes.handleWebhookEventMock,
    consumePendingPayNoteBootstrapEvents:
      hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock,
  };
});

describe('payNoteWebhookHandler', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    delete process.env.SUMMARY_QUEUE_URL;
    delete process.env.SUMMARY_LAMBDA_NAME;

    hoistedDeps.getDependenciesMock.mockReset();
    hoistedDeps.createResolveMerchantOwnerUserIdMock.mockReset();
    hoistedDeps.createResolveMerchantNameByIdMock.mockReset();
    hoistedDeps.createResolveMerchantOwnerUserIdMock.mockImplementation(
      (merchantDirectoryRepository: {
          getMerchantsByIds: (
            merchantIds: string[]
          ) => Promise<Array<{ merchantId: string; ownerUserId?: string }>>;
        }) =>
        async (merchantId: string): Promise<string | undefined> => {
          const entries = await merchantDirectoryRepository.getMerchantsByIds([
            merchantId,
          ]);
          const entry = entries.find(item => item.merchantId === merchantId);
          return entry?.ownerUserId;
        }
    );
    hoistedDeps.createResolveMerchantNameByIdMock.mockImplementation(
      (merchantDirectoryRepository: {
          getMerchantsByIds: (
            merchantIds: string[]
          ) => Promise<Array<{ merchantId: string; name?: string }>>;
        }) =>
        async (merchantId: string): Promise<string | undefined> => {
          const entries = await merchantDirectoryRepository.getMerchantsByIds([
            merchantId,
          ]);
          const entry = entries.find(item => item.merchantId === merchantId);
          return entry?.name;
        }
    );
    logger.info.mockReset();
    logger.error.mockReset();
    logger.warn.mockReset();
    logger.debug.mockReset();
    hoistedAdapters.fetchEventImpl.mockReset();
    hoistedAdapters.fetchDocumentImpl.mockReset();
    hoistedAdapters.getAccountByNumberImpl.mockReset();
    hoistedAdapters.getPayNoteBySessionIdImpl.mockReset();
    hoistedAdapters.transferFundsMock.mockReset();
    hoistedAdapters.reserveFundsMock.mockReset();
    hoistedAdapters.captureHoldMock.mockReset();
    hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock.mockReset();
    hoistedPaynotes.handlePayNoteBootstrapWebhookEventMock.mockClear();
    hoistedPaynotes.handleWebhookEventMock.mockClear();
    hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock.mockReset();
    hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock.mockResolvedValue({
      handled: false,
      logs: [],
    });
    hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock.mockResolvedValue({
      handled: false,
      logs: [],
    });

    hoistedAdapters.fetchDocumentImpl.mockResolvedValue({
      kind: 'success',
      document: { documentId: 'doc-default', sessionId: 'session-default' },
    });
    hoistedAdapters.getPayNoteBySessionIdImpl.mockResolvedValue(null);
    hoistedAdapters.captureHoldMock.mockResolvedValue({ holdId: 'hold-1' });

    const myOsClient = {
      getCredentials: vi.fn(),
      bootstrapDocument: vi.fn(),
      fetchEvent: (eventId: string) => hoistedAdapters.fetchEventImpl(eventId),
      fetchDocument: (sessionId: string) =>
        hoistedAdapters.fetchDocumentImpl(sessionId),
    };

    const bankingFacade = {
      getAccountByNumber: (accountNumber: string) =>
        hoistedAdapters.getAccountByNumberImpl(accountNumber),
      getAccountForUser: vi.fn(),
      getActiveCreditLineAccountByMerchantId: vi.fn().mockResolvedValue(null),
      transferFunds: hoistedAdapters.transferFundsMock,
      reserveFunds: hoistedAdapters.reserveFundsMock,
      captureHold: hoistedAdapters.captureHoldMock,
    };

    const contractRepository = {
      getContract: vi.fn(),
      getContractBySessionId: vi.fn(),
      getContractByDocumentId: vi.fn(),
      linkSessionToContract: vi.fn(),
      markSummaryEventProcessed: vi.fn().mockResolvedValue(true),
      saveContract: vi.fn(),
      updateContractSummary: vi.fn(),
      listContractsByUserId: vi.fn(),
      getContractPollingMarkerByUserId: vi.fn(),
    };
    const summaryInputStore = {
      save: vi.fn(),
      get: vi.fn(),
    };
    const bootstrapContextRepository = {
      getContextBySessionId: vi.fn().mockResolvedValue({
        bootstrapSessionId: 'bootstrap-context-default',
        createdAt: '2024-01-01T00:00:00.000Z',
      }),
      getBootstrapSessionIdByTargetSessionId: vi.fn().mockResolvedValue(null),
      saveContext: vi.fn(),
      saveTargetSessionBootstrapLink: vi.fn(),
    };
    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn(),
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      getDeliveryPollingMarkerByUserId: vi.fn(),
    };
    hoistedRepositories.contractRepository = contractRepository;
    hoistedRepositories.summaryInputStore = summaryInputStore;
    hoistedRepositories.bootstrapContextRepository = bootstrapContextRepository;
    hoistedRepositories.payNoteDeliveryRepository = payNoteDeliveryRepository;

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      myOsClient,
      bankingFacade,
      payNoteRepository: {
        getPayNote: vi.fn(),
        getPayNoteBySessionId: (sessionId: string) =>
          hoistedAdapters.getPayNoteBySessionIdImpl(sessionId),
        savePayNote: vi.fn(),
        markEventProcessed: vi.fn().mockResolvedValue(true),
      },
      payNoteDeliveryRepository: {
        ...payNoteDeliveryRepository,
      },
      payNoteBootstrapRepository: {
        getBootstrapBySessionId: vi.fn(),
        saveBootstrap: vi.fn(),
      },
      bootstrapContextRepository,
      pendingBootstrapEventRepository: {
        addPending: vi.fn(),
        listPending: vi.fn(),
        deletePending: vi.fn(),
      },
      contractRepository,
      summaryInputStore,
      bankingRepository: {
        getAccountIdByNumber: vi.fn(),
        getAccountById: vi.fn(),
        getAccountsByUserId: vi.fn().mockResolvedValue([]),
      },
      holdRepository: {
        getHoldByCardTransactionDetails: vi.fn(),
        disableHoldCapture: vi.fn(),
        getHold: vi.fn(),
        putHoldMeta: vi.fn(),
      },
      merchantDirectoryRepository: {
        getMerchantsByIds: vi.fn().mockResolvedValue([]),
        upsertMerchantProfile: vi.fn(),
      },
      getMyOsCredentials: vi.fn(),
      getOpenAiApiKey: vi.fn(),
      payNoteVerificationRepository: {} as any,
      blueIdCalculator: {
        fromYaml: vi.fn(),
        fromObject: vi.fn(),
        toReversedJson: (value: unknown) => value,
      },
      clock: { now: () => new Date() },
      idGenerator: { generate: vi.fn() },
    });
  });

  it('handles capture, reserve, and transfer events', async () => {
    const payload = {
      id: 'event-123',
      object: {
        sessionId: 'session-1',
        document: {
          type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
          payerAccountNumber: { value: '9559276001' },
          payeeAccountNumber: { value: '9595234002' },
          amount: { total: { value: 16000 } },
          name: 'Invoice Q3',
        },
        emitted: [
          {
            type: {
              name: 'PayNote/Reserve Funds and Capture Immediately Requested',
              blueId:
                paynoteBlueIds[
                  'PayNote/Reserve Funds and Capture Immediately Requested'
                ],
            },
            amount: { value: 15000 },
          },
          {
            type: {
              name: 'PayNote/Capture Funds Requested',
              blueId: paynoteBlueIds['PayNote/Capture Funds Requested'],
            },
            amount: { value: 15000 },
          },
          {
            type: {
              name: 'PayNote/Reserve Funds Requested',
              blueId: paynoteBlueIds['PayNote/Reserve Funds Requested'],
            },
            amount: { value: 15000 },
          },
        ],
      },
    };

    hoistedAdapters.fetchEventImpl.mockResolvedValue({
      kind: 'success',
      payload,
    });
    hoistedAdapters.fetchDocumentImpl.mockResolvedValue({
      kind: 'success',
      document: { documentId: 'doc-123', sessionId: 'session-1' },
    });
    hoistedAdapters.getAccountByNumberImpl.mockResolvedValue({
      id: 'acct-123',
      accountNumber: '9559276001',
      ownerUserId: 'user-456',
    });
    hoistedAdapters.getPayNoteBySessionIdImpl.mockResolvedValue({
      payNoteDocumentId: 'doc-123',
      sessionId: 'session-1',
      holdId: 'hold-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const response = await payNoteWebhookHandler({
      body: { id: 'event-123' },
    } as any);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(hoistedAdapters.transferFundsMock).toHaveBeenCalledWith({
      sourceAccountId: 'acct-123',
      destinationAccountNumber: '9595234002',
      amountMinor: 15000,
      description: 'Invoice Q3',
      userId: 'user-456',
      idempotencyKey:
        'paynote-transfer:capture-immediately:doc-123:event:event-123:0',
      payNoteDocumentId: 'doc-123',
    });
    expect(hoistedAdapters.captureHoldMock).toHaveBeenCalledWith({
      holdId: 'hold-1',
      userId: 'user-456',
      idempotencyKey:
        'paynote-transfer:capture-funds:doc-123:event:event-123:1',
      amountMinor: 15000,
      counterpartyAccountNumber: '9595234002',
      payNoteDocumentId: 'doc-123',
    });
    expect(hoistedAdapters.reserveFundsMock).toHaveBeenCalledWith({
      holdId: 'hold-1',
      payerAccountNumber: '9559276001',
      amountMinor: 15000,
      counterpartyAccountNumber: '9595234002',
      userId: 'user-456',
      idempotencyKey:
        'paynote-transfer:reserve-funds:doc-123:event:event-123:2',
      payNoteDocumentId: 'doc-123',
    });
    expect(logger.debug).toHaveBeenCalledWith(
      'PayNote capture immediately request received',
      expect.objectContaining({ transferAmountMinor: 15000 })
    );
  });

  it('logs ignored events when no capture action occurs', async () => {
    hoistedAdapters.fetchEventImpl.mockResolvedValue({
      kind: 'success',
      payload: {
        id: 'event-456',
        object: {
          sessionId: 'session-2',
          document: {
            type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
            payerAccountNumber: { value: '1111111111' },
            payeeAccountNumber: { value: '2222222222' },
          },
          emitted: [
            {
              type: {
                name: 'PayNote/PayNote Cancelled',
                blueId: paynoteBlueIds['PayNote/PayNote Cancelled'],
              },
            },
          ],
        },
      },
    });
    hoistedAdapters.getAccountByNumberImpl.mockResolvedValue({
      id: 'acct-123',
      accountNumber: '1111111111',
      ownerUserId: 'user-456',
    });

    await payNoteWebhookHandler({ body: { id: 'event-456' } } as any);

    expect(hoistedAdapters.transferFundsMock).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'PayNote emitted event intentionally ignored (unsupported type)',
      expect.objectContaining({ eventType: 'PayNote/PayNote Cancelled' })
    );
  });

  it('returns early when payload lacks event id', async () => {
    const response = await payNoteWebhookHandler({ body: {} } as any);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      note: 'PayNote webhook received payload without valid id',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'PayNote webhook received payload without valid id',
      expect.any(Object)
    );
  });

  it('logs download errors when MyOS request fails', async () => {
    hoistedAdapters.fetchEventImpl.mockResolvedValue({
      kind: 'http-error',
      status: 503,
      statusText: 'Service Unavailable',
    });

    const response = await payNoteWebhookHandler({
      body: { id: 'event-999' },
    } as any);

    expect(response.body.note).toBe(
      'Failed to download PayNote event from MyOS'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to download PayNote event from MyOS',
      expect.objectContaining({ eventId: 'event-999', status: 503 })
    );
  });

  it('short-circuits when PayNote Delivery handler processes the event', async () => {
    hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock.mockResolvedValue({
      handled: true,
      logs: [],
    });

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-delivery',
        object: { document: { type: { blueId: PAYNOTE_DELIVERY_BLUE_ID } } },
      },
    } as any);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(hoistedAdapters.transferFundsMock).not.toHaveBeenCalled();
    expect(hoistedAdapters.fetchEventImpl).not.toHaveBeenCalled();
  });

  it('routes bootstrap request events to the delivery handler', async () => {
    const payload = {
      id: 'event-bootstrap',
      object: {
        sessionId: 'sync-session',
        document: {
          name: 'Synchrony Merchant',
          type: { blueId: 'SynchronyMerchant' },
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
    };

    await payNoteWebhookHandler({ body: payload } as any);

    expect(
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock
    ).toHaveBeenCalledWith(
      { eventId: 'event-bootstrap', payload },
      expect.any(Object)
    );
  });

  it('routes schema-shaped bootstrap request events to the delivery handler', async () => {
    const payload = {
      id: 'event-bootstrap-schema-shaped',
      object: {
        sessionId: 'sync-session-schema-shaped',
        document: {
          name: 'Synchrony Merchant',
          type: { blueId: 'SynchronyMerchant' },
        },
        emitted: [buildSchemaShapedDocumentBootstrapRequestedEvent()],
      },
    };

    await payNoteWebhookHandler({ body: payload } as any);

    expect(
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock
    ).toHaveBeenCalledWith(
      { eventId: 'event-bootstrap-schema-shaped', payload },
      expect.any(Object)
    );
  });

  it('routes schema-shaped bootstrap request nodes to the delivery handler', async () => {
    const payload = {
      id: 'event-bootstrap-schema-node',
      object: {
        sessionId: 'sync-session-schema-node',
        document: {
          name: 'Synchrony Merchant',
          type: { blueId: 'SynchronyMerchant' },
        },
        emitted: [buildSchemaShapedDocumentBootstrapRequestedNode()],
      },
    };

    await payNoteWebhookHandler({ body: payload } as any);

    expect(
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock
    ).toHaveBeenCalledWith(
      { eventId: 'event-bootstrap-schema-node', payload },
      expect.any(Object)
    );
  });

  it('routes checkpoint-stashed bootstrap request nodes to the delivery handler', async () => {
    const payload = {
      id: 'event-bootstrap-checkpoint-node',
      object: {
        sessionId: 'sync-session-checkpoint-node',
        document: buildSynchronyDocumentWithCheckpointBootstrapRequest(),
        emitted: [],
      },
    };

    await payNoteWebhookHandler({ body: payload } as any);

    expect(
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock
    ).toHaveBeenCalledWith(
      { eventId: 'event-bootstrap-checkpoint-node', payload },
      expect.any(Object)
    );
  });

  it('handles active paynote bootstrap requests after paynote persistence', async () => {
    const payload = {
      id: 'event-paynote-bootstrap-after-persist',
      object: {
        sessionId: 'paynote-session-1',
        document: {
          type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
          name: 'Active PayNote',
        },
        emitted: [buildSchemaShapedDocumentBootstrapRequestedEvent()],
      },
    };

    hoistedPaynotes.handleWebhookEventMock.mockResolvedValue({
      note: '',
      logs: [],
    });
    hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock.mockResolvedValue({
      handled: true,
      logs: [],
    });

    const response = await payNoteWebhookHandler({ body: payload } as any);

    expect(response.status).toBe(200);
    expect(hoistedPaynotes.handleWebhookEventMock).toHaveBeenCalledWith(
      {
        eventId: 'event-paynote-bootstrap-after-persist',
        eventPayload: payload,
      },
      expect.any(Object)
    );
    expect(
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock
    ).toHaveBeenCalledWith(
      { eventId: 'event-paynote-bootstrap-after-persist', payload },
      expect.any(Object)
    );
    expect(
      hoistedPaynotes.handleWebhookEventMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock.mock
        .invocationCallOrder[0]
    );
  });

  it('routes Payment Mandate webhook events to paynote webhook use case', async () => {
    const payload = {
      id: 'event-mandate-webhook',
      object: {
        sessionId: 'session-mandate-webhook',
        document: {
          type: {
            blueId: paynoteBlueIds['PayNote/Payment Mandate'],
          },
        },
        emitted: [
          {
            type: {
              name: 'PayNote/Payment Mandate Spend Authorization Responded',
              blueId:
                paynoteBlueIds[
                  'PayNote/Payment Mandate Spend Authorization Responded'
                ],
            },
            status: 'approved',
            chargeAttemptId: 'attempt-1',
          },
        ],
      },
    };

    const response = await payNoteWebhookHandler({ body: payload } as any);

    expect(response.status).toBe(200);
    expect(hoistedPaynotes.handleWebhookEventMock).toHaveBeenCalledWith(
      {
        eventId: 'event-mandate-webhook',
        eventPayload: payload,
      },
      expect.any(Object)
    );
  });

  it('rejects unknown paynote session when bootstrap context is missing', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
      null
    );

    await expect(
      payNoteWebhookHandler({
        body: {
          id: 'event-unknown-paynote-session',
          object: {
            sessionId: 'unknown-session-1',
            document: {
              name: 'Unknown PayNote',
              type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
            },
          },
        },
      } as any)
    ).rejects.toThrow(
      'Unknown webhook session "unknown-session-1" (no bootstrap context mapping)'
    );
    expect(hoistedPaynotes.handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('hydrates root paynote participant session from pending delivery bootstrap events before canonical session is known', async () => {
    let bootstrapConsumed = false;
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockImplementation(
      async (sessionId: string) =>
        sessionId === 'bootstrap-delivery-1'
          ? {
              bootstrapSessionId: 'bootstrap-delivery-1',
              createdAt: '2024-01-01T00:00:00.000Z',
            }
          : null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockImplementation(
      async (targetSessionId: string) =>
        bootstrapConsumed && targetSessionId === 'shadow-paynote-root-1'
          ? 'bootstrap-delivery-1'
          : null
    );
    hoistedRepositories.payNoteDeliveryRepository.getDeliveryByCardTransactionDetails.mockResolvedValue(
      {
        deliveryId: 'delivery-1',
        payNoteBootstrapSessionId: 'bootstrap-delivery-1',
      }
    );
    hoistedRepositories.contractRepository.getContractByDocumentId.mockResolvedValue(
      null
    );
    hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock.mockImplementation(
      async () => {
        bootstrapConsumed = true;
        return { handled: true, logs: [] };
      }
    );
    hoistedPaynotes.handleWebhookEventMock.mockResolvedValue({
      note: '',
      logs: [],
    });

    const payload = {
      id: 'event-root-paynote-participant-session',
      object: {
        sessionId: 'shadow-paynote-root-1',
        document: {
          name: 'Known Root PayNote',
          type: 'PayNote/Card Transaction PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
          cardTransactionDetails: {
            retrievalReferenceNumber: { value: '123456789012' },
            systemTraceAuditNumber: { value: '123456' },
            transmissionDateTime: { value: '0214140000' },
            authorizationCode: { value: 'ABC123' },
          },
        },
      },
    };

    const response = await payNoteWebhookHandler({ body: payload } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedRepositories.payNoteDeliveryRepository
        .getDeliveryByCardTransactionDetails
    ).toHaveBeenCalledWith({
      retrievalReferenceNumber: '123456789012',
      systemTraceAuditNumber: '123456',
      transmissionDateTime: '0214140000',
      authorizationCode: 'ABC123',
    });
    expect(
      hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock
    ).toHaveBeenCalledWith(
      { bootstrapSessionId: 'bootstrap-delivery-1' },
      expect.any(Object)
    );
    expect(
      hoistedRepositories.bootstrapContextRepository
        .saveTargetSessionBootstrapLink
    ).not.toHaveBeenCalled();
    expect(
      hoistedRepositories.contractRepository.getContractByDocumentId
    ).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Resolved webhook session after consuming pending bootstrap events',
      expect.objectContaining({
        eventId: 'event-root-paynote-participant-session',
        sessionId: 'shadow-paynote-root-1',
        source: 'delivery',
        bootstrapSessionId: 'bootstrap-delivery-1',
        deliveryId: 'delivery-1',
      })
    );
    expect(hoistedPaynotes.handleWebhookEventMock).toHaveBeenCalledWith(
      {
        eventId: 'event-root-paynote-participant-session',
        eventPayload: payload,
      },
      expect.any(Object)
    );
  });

  it('hydrates root paynote participant session from MyOS bootstrap state when no pending bootstrap events exist', async () => {
    let bootstrapHydrated = false;
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockImplementation(
      async (sessionId: string) =>
        sessionId === 'bootstrap-delivery-sync-1'
          ? {
              bootstrapSessionId: 'bootstrap-delivery-sync-1',
              createdAt: '2024-01-01T00:00:00.000Z',
            }
          : null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockImplementation(
      async (targetSessionId: string) =>
        bootstrapHydrated && targetSessionId === 'shadow-paynote-root-sync-1'
          ? 'bootstrap-delivery-sync-1'
          : null
    );
    hoistedRepositories.payNoteDeliveryRepository.getDeliveryByCardTransactionDetails.mockResolvedValue(
      {
        deliveryId: 'delivery-sync-1',
        payNoteBootstrapSessionId: 'bootstrap-delivery-sync-1',
      }
    );
    hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock.mockResolvedValue({
      handled: true,
      logs: [],
    });
    hoistedAdapters.fetchDocumentImpl.mockImplementation(
      async (sessionId: string) =>
        sessionId === 'bootstrap-delivery-sync-1'
          ? {
              kind: 'success',
              document: {
                documentId: 'bootstrap-doc-sync-1',
                sessionId,
                document: {
                  type: {
                    blueId: myosBlueIds['MyOS/Document Session Bootstrap'],
                  },
                  initiatorSessionIds: {
                    items: [{ value: 'session-canonical-sync-1' }],
                  },
                },
              },
            }
          : {
              kind: 'success',
              document: { documentId: 'doc-default', sessionId },
            }
    );
    hoistedPaynotes.handlePayNoteBootstrapWebhookEventMock.mockImplementationOnce(
      async () => {
        bootstrapHydrated = true;
        return { handled: true, logs: [] };
      }
    );
    hoistedPaynotes.handleWebhookEventMock.mockResolvedValue({
      note: '',
      logs: [],
    });

    const payload = {
      id: 'event-root-paynote-bootstrap-sync',
      object: {
        sessionId: 'shadow-paynote-root-sync-1',
        document: {
          name: 'Known Root PayNote',
          type: 'PayNote/Card Transaction PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
          cardTransactionDetails: {
            retrievalReferenceNumber: { value: '123456789012' },
            systemTraceAuditNumber: { value: '123456' },
            transmissionDateTime: { value: '0214140000' },
            authorizationCode: { value: 'ABC123' },
          },
        },
      },
    };

    const response = await payNoteWebhookHandler({ body: payload } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock
    ).toHaveBeenCalledWith(
      { bootstrapSessionId: 'bootstrap-delivery-sync-1' },
      expect.any(Object)
    );
    expect(hoistedAdapters.fetchDocumentImpl).toHaveBeenCalledWith(
      'bootstrap-delivery-sync-1'
    );
    expect(
      hoistedPaynotes.handlePayNoteBootstrapWebhookEventMock
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        skipEventIdempotencyClaim: true,
        skipPendingBuffer: true,
        skipExternalReporting: true,
      }),
      expect.any(Object)
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Resolved webhook session after hydrating bootstrap session',
      expect.objectContaining({
        eventId: 'event-root-paynote-bootstrap-sync',
        sessionId: 'shadow-paynote-root-sync-1',
        source: 'delivery',
        bootstrapSessionId: 'bootstrap-delivery-sync-1',
        deliveryId: 'delivery-sync-1',
      })
    );
    expect(hoistedPaynotes.handleWebhookEventMock).toHaveBeenCalledWith(
      {
        eventId: 'event-root-paynote-bootstrap-sync',
        eventPayload: payload,
      },
      expect.any(Object)
    );
  });

  it('links verified root paynote shadow session alias after bootstrap hydration when session is not in bootstrap target ids', async () => {
    let bootstrapHydrated = false;
    let aliasLinked = false;
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockImplementation(
      async (sessionId: string) =>
        sessionId === 'bootstrap-delivery-alias-1'
          ? {
              bootstrapSessionId: 'bootstrap-delivery-alias-1',
              createdAt: '2024-01-01T00:00:00.000Z',
            }
          : null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockImplementation(
      async (targetSessionId: string) => {
        if (
          bootstrapHydrated &&
          (targetSessionId === 'session-canonical-alias-1' ||
            targetSessionId === 'session-participant-alias-1')
        ) {
          return 'bootstrap-delivery-alias-1';
        }
        if (aliasLinked && targetSessionId === 'shadow-paynote-epoch-alias-1') {
          return 'bootstrap-delivery-alias-1';
        }
        return null;
      }
    );
    hoistedRepositories.bootstrapContextRepository.saveTargetSessionBootstrapLink.mockImplementation(
      async ({
        targetSessionId,
        bootstrapSessionId,
      }: {
        targetSessionId: string;
        bootstrapSessionId: string;
      }) => {
        if (
          targetSessionId === 'shadow-paynote-epoch-alias-1' &&
          bootstrapSessionId === 'bootstrap-delivery-alias-1'
        ) {
          aliasLinked = true;
        }
      }
    );
    hoistedRepositories.payNoteDeliveryRepository.getDeliveryByCardTransactionDetails.mockResolvedValue(
      {
        deliveryId: 'delivery-alias-1',
        payNoteBootstrapSessionId: 'bootstrap-delivery-alias-1',
      }
    );
    hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock.mockResolvedValue({
      handled: true,
      logs: [],
    });
    hoistedAdapters.fetchDocumentImpl.mockImplementation(
      async (sessionId: string) =>
        sessionId === 'bootstrap-delivery-alias-1'
          ? {
              kind: 'success',
              document: {
                documentId: 'bootstrap-doc-alias-1',
                sessionId,
                document: {
                  type: {
                    blueId: myosBlueIds['MyOS/Document Session Bootstrap'],
                  },
                  initiatorSessionIds: {
                    items: [
                      { value: 'session-canonical-alias-1' },
                      { value: 'session-participant-alias-1' },
                    ],
                  },
                },
              },
            }
          : {
              kind: 'success',
              document: { documentId: 'doc-default', sessionId },
            }
    );
    hoistedPaynotes.handlePayNoteBootstrapWebhookEventMock.mockImplementationOnce(
      async () => {
        bootstrapHydrated = true;
        return { handled: true, logs: [] };
      }
    );
    hoistedPaynotes.handleWebhookEventMock.mockResolvedValue({
      note: '',
      logs: [],
    });

    const payload = {
      id: 'event-root-paynote-bootstrap-alias',
      object: {
        sessionId: 'shadow-paynote-epoch-alias-1',
        epoch: 0,
        document: {
          name: 'Known Root PayNote',
          type: 'PayNote/Card Transaction PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
          cardTransactionDetails: {
            retrievalReferenceNumber: { value: '123456789012' },
            systemTraceAuditNumber: { value: '123456' },
            transmissionDateTime: { value: '0214140000' },
            authorizationCode: { value: 'ABC123' },
          },
        },
      },
    };

    const response = await payNoteWebhookHandler({ body: payload } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedRepositories.bootstrapContextRepository
        .saveTargetSessionBootstrapLink
    ).toHaveBeenCalledWith({
      targetSessionId: 'shadow-paynote-epoch-alias-1',
      bootstrapSessionId: 'bootstrap-delivery-alias-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Resolved webhook session via verified bootstrap candidate alias',
      expect.objectContaining({
        eventId: 'event-root-paynote-bootstrap-alias',
        sessionId: 'shadow-paynote-epoch-alias-1',
        source: 'delivery',
        bootstrapSessionId: 'bootstrap-delivery-alias-1',
        deliveryId: 'delivery-alias-1',
      })
    );
    expect(hoistedPaynotes.handleWebhookEventMock).toHaveBeenCalledWith(
      {
        eventId: 'event-root-paynote-bootstrap-alias',
        eventPayload: payload,
      },
      expect.any(Object)
    );
  });

  it('rejects paynote shadow session when canonical contract has no bootstrap link', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockImplementation(
      async () => null
    );
    hoistedRepositories.contractRepository.getContractByDocumentId.mockResolvedValue(
      {
        sessionId: 'session-canonical-1',
      }
    );
    await expect(
      payNoteWebhookHandler({
        body: {
          id: 'event-known-paynote-shadow-session',
          object: {
            sessionId: 'shadow-session-1',
            blueId: 'doc-1',
            document: {
              name: 'Known PayNote',
              type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
            },
          },
        },
      } as any)
    ).rejects.toThrow(
      'Unknown webhook session "shadow-session-1" (no bootstrap context mapping)'
    );
    expect(
      hoistedRepositories.bootstrapContextRepository
        .saveTargetSessionBootstrapLink
    ).not.toHaveBeenCalled();
    expect(hoistedPaynotes.handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('allows paynote shadow session once canonical target session is linked', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockImplementation(
      async (targetSessionId: string) =>
        targetSessionId === 'session-canonical-1' ? 'bootstrap-1' : null
    );
    hoistedRepositories.contractRepository.getContractByDocumentId.mockResolvedValue(
      {
        contractId: 'contract-1',
        sessionId: 'session-canonical-1',
        documentId: 'doc-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      }
    );
    hoistedPaynotes.handleWebhookEventMock.mockResolvedValue({
      note: '',
      logs: [],
    });

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-stale-paynote-shadow-session',
        object: {
          sessionId: 'shadow-session-1',
          blueId: 'doc-1',
          document: {
            name: 'Known PayNote',
            type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
          },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedRepositories.contractRepository.getContractByDocumentId
    ).toHaveBeenCalledWith('doc-1');
    expect(
      hoistedRepositories.bootstrapContextRepository
        .saveTargetSessionBootstrapLink
    ).toHaveBeenCalledWith({
      targetSessionId: 'shadow-session-1',
      bootstrapSessionId: 'bootstrap-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    expect(hoistedPaynotes.handleWebhookEventMock).toHaveBeenCalledWith(
      {
        eventId: 'event-stale-paynote-shadow-session',
        eventPayload: {
          id: 'event-stale-paynote-shadow-session',
          object: {
            sessionId: 'shadow-session-1',
            blueId: 'doc-1',
            document: {
              name: 'Known PayNote',
              type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
            },
          },
        },
      },
      expect.any(Object)
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Allowing supported contract webhook session via canonical bootstrap verification',
      expect.objectContaining({
        eventId: 'event-stale-paynote-shadow-session',
        sessionId: 'shadow-session-1',
        canonicalSessionId: 'session-canonical-1',
        bootstrapSessionId: 'bootstrap-1',
        contractDocumentId: 'doc-1',
      })
    );
  });

  it('allows paynote shadow session via MyOS document lookup when webhook payload lacks document id', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockImplementation(
      async (targetSessionId: string) =>
        targetSessionId === 'session-canonical-1' ? 'bootstrap-1' : null
    );
    hoistedRepositories.contractRepository.getContractByDocumentId.mockResolvedValue(
      {
        sessionId: 'session-canonical-1',
      }
    );
    hoistedAdapters.fetchDocumentImpl.mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-runtime-lookup-1',
        sessionId: 'shadow-session-lookup-1',
        document: {
          initialized: {
            documentId: {
              value: 'doc-lookup-1',
            },
          },
        },
      },
    });
    hoistedPaynotes.handleWebhookEventMock.mockResolvedValue({
      note: '',
      logs: [],
    });

    const payload = {
      id: 'event-paynote-shadow-session-document-lookup',
      object: {
        sessionId: 'shadow-session-lookup-1',
        document: {
          name: 'Known PayNote',
          type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
        },
        emitted: [
          {
            type: {
              name: 'PayNote/Payment Mandate Attached',
              blueId: paynoteBlueIds['PayNote/Payment Mandate Attached'],
            },
          },
        ],
      },
    };

    const response = await payNoteWebhookHandler({ body: payload } as any);

    expect(response.status).toBe(200);
    expect(hoistedAdapters.fetchDocumentImpl).toHaveBeenCalledWith(
      'shadow-session-lookup-1'
    );
    expect(
      hoistedRepositories.contractRepository.getContractByDocumentId
    ).toHaveBeenCalledWith('doc-lookup-1');
    expect(hoistedPaynotes.handleWebhookEventMock).toHaveBeenCalledWith(
      {
        eventId: 'event-paynote-shadow-session-document-lookup',
        eventPayload: payload,
      },
      expect.any(Object)
    );
  });

  it('allows later shadow session events via existing session alias without payload document lookup', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockImplementation(
      async (targetSessionId: string) =>
        targetSessionId === 'session-canonical-1' ? 'bootstrap-1' : null
    );
    hoistedRepositories.contractRepository.getContractBySessionId.mockImplementation(
      async (sessionId: string) =>
        sessionId === 'shadow-session-aliased-1'
          ? {
              contractId: 'contract-1',
              sessionId: 'session-canonical-1',
              documentId: 'doc-1',
              createdAt: '2024-01-01T00:00:00.000Z',
            }
          : null
    );
    hoistedPaynotes.handleWebhookEventMock.mockResolvedValue({
      note: '',
      logs: [],
    });

    const payload = {
      id: 'event-paynote-shadow-session-aliased',
      object: {
        sessionId: 'shadow-session-aliased-1',
        document: {
          name: 'Known PayNote',
          type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
        },
        emitted: [
          {
            type: {
              name: 'PayNote/Payment Mandate Attached',
              blueId: paynoteBlueIds['PayNote/Payment Mandate Attached'],
            },
          },
        ],
      },
    };

    const response = await payNoteWebhookHandler({ body: payload } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedRepositories.contractRepository.getContractBySessionId
    ).toHaveBeenCalledWith('shadow-session-aliased-1');
    expect(hoistedAdapters.fetchDocumentImpl).not.toHaveBeenCalledWith(
      'shadow-session-aliased-1'
    );
    expect(hoistedPaynotes.handleWebhookEventMock).toHaveBeenCalledWith(
      {
        eventId: 'event-paynote-shadow-session-aliased',
        eventPayload: payload,
      },
      expect.any(Object)
    );
  });

  it('rejects unknown payment mandate session when bootstrap context is missing', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
      null
    );

    await expect(
      payNoteWebhookHandler({
        body: {
          id: 'event-unknown-payment-mandate-session',
          object: {
            sessionId: 'unknown-payment-mandate-session',
            document: {
              name: 'Unknown Payment Mandate',
              type: { blueId: paynoteBlueIds['PayNote/Payment Mandate'] },
            },
          },
        },
      } as any)
    ).rejects.toThrow(
      'Unknown webhook session "unknown-payment-mandate-session" (no bootstrap context mapping)'
    );
    expect(hoistedPaynotes.handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('allows payment mandate participant session once canonical target session is linked', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockImplementation(
      async (targetSessionId: string) =>
        targetSessionId === 'session-canonical-mandate-1'
          ? 'bootstrap-mandate-1'
          : null
    );
    hoistedRepositories.contractRepository.getContractByDocumentId.mockResolvedValue(
      {
        contractId: 'contract-mandate-1',
        sessionId: 'session-canonical-mandate-1',
        documentId: 'doc-mandate-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      }
    );
    hoistedPaynotes.handleWebhookEventMock.mockResolvedValue({
      note: '',
      logs: [],
    });

    const payload = {
      id: 'event-shadow-payment-mandate-session',
      object: {
        sessionId: 'shadow-payment-mandate-1',
        blueId: 'mandate-epoch-blue-id',
        document: {
          name: 'Subscription Payment Mandate',
          type: { blueId: paynoteBlueIds['PayNote/Payment Mandate'] },
          initialized: {
            documentId: {
              value: 'doc-mandate-1',
            },
          },
        },
      },
    };

    const response = await payNoteWebhookHandler({ body: payload } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedRepositories.contractRepository.getContractByDocumentId
    ).toHaveBeenCalledWith('doc-mandate-1');
    expect(
      hoistedRepositories.bootstrapContextRepository
        .saveTargetSessionBootstrapLink
    ).toHaveBeenCalledWith({
      targetSessionId: 'shadow-payment-mandate-1',
      bootstrapSessionId: 'bootstrap-mandate-1',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    expect(hoistedPaynotes.handleWebhookEventMock).toHaveBeenCalledWith(
      {
        eventId: 'event-shadow-payment-mandate-session',
        eventPayload: payload,
      },
      expect.any(Object)
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Allowing supported contract webhook session via canonical bootstrap verification',
      expect.objectContaining({
        eventId: 'event-shadow-payment-mandate-session',
        sessionId: 'shadow-payment-mandate-1',
        canonicalSessionId: 'session-canonical-mandate-1',
        bootstrapSessionId: 'bootstrap-mandate-1',
        contractDocumentId: 'doc-mandate-1',
      })
    );
  });

  it('keeps payment mandate participant sessions behind session gate until bootstrap target session link exists', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.payNoteDeliveryRepository.listDeliveriesByUserId.mockResolvedValue(
      [
        {
          deliveryId: 'delivery-1',
          merchantId: 'merchant-1',
          payNoteDocumentId: 'root-paynote-doc-1',
          paymentMandateStatus: 'pending',
        },
      ]
    );
    hoistedRepositories.contractRepository.getContractByDocumentId.mockResolvedValue(
      {
        contractId: 'contract-root-1',
        sessionId: 'contract-session-1',
        pendingActions: [
          {
            type: 'paymentMandateBootstrapApproval',
            status: 'accepted',
            payload: {
              paymentMandateBootstrapSessionId: 'bootstrap-mandate-action-1',
              paymentMandateDocument: {
                name: 'Subscription Payment Mandate',
                granterId: { value: 'user-1' },
                granterType: { value: 'customer' },
                granteeType: { value: 'merchantId' },
                granteeId: { value: 'merchant-1' },
                currency: { value: 'USD' },
                amountLimit: { value: 14400 },
                expiresAt: { value: '2027-12-31 23:59:59 UTC' },
                sourceAccount: { value: 'root' },
              },
            },
          },
        ],
      }
    );

    const payload = {
      id: 'event-payment-mandate-session-gated',
      object: {
        sessionId: 'shadow-payment-mandate-action-1',
        document: {
          name: 'Subscription Payment Mandate',
          type: { blueId: paynoteBlueIds['PayNote/Payment Mandate'] },
          granterType: { value: 'customer' },
          granterId: { value: 'user-actual-1' },
          granteeType: { value: 'merchantId' },
          granteeId: { value: 'merchant-1' },
          currency: { value: 'USD' },
          amountLimit: { value: 14400 },
          expiresAt: { value: '2027-12-31 23:59:59 UTC' },
          sourceAccount: { value: 'root' },
        },
      },
    };

    await expect(
      payNoteWebhookHandler({ body: payload } as any)
    ).rejects.toThrow(
      'Unknown webhook session "shadow-payment-mandate-action-1" (no bootstrap context mapping)'
    );
    expect(
      hoistedRepositories.payNoteDeliveryRepository.listDeliveriesByUserId
    ).not.toHaveBeenCalled();
    expect(
      hoistedPaynotes.consumePendingPayNoteBootstrapEventsMock
    ).not.toHaveBeenCalled();
    expect(
      hoistedPaynotes.handlePayNoteBootstrapWebhookEventMock
    ).not.toHaveBeenCalled();
    expect(hoistedPaynotes.handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('rejects unknown paynote session with emitted bootstrap request when bootstrap context is missing', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
      null
    );
    hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock.mockResolvedValue({
      handled: true,
      logs: [],
    });
    hoistedPaynotes.handleWebhookEventMock.mockResolvedValue({
      note: '',
      logs: [],
    });

    await expect(
      payNoteWebhookHandler({
        body: {
          id: 'event-paynote-bootstrap-request',
          object: {
            sessionId: 'paynote-unknown-bootstrap-session',
            document: {
              name: 'Active PayNote',
              type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
            },
            emitted: [buildSchemaShapedDocumentBootstrapRequestedEvent()],
          },
        },
      } as any)
    ).rejects.toThrow(
      'Unknown webhook session "paynote-unknown-bootstrap-session" (no bootstrap context mapping)'
    );
    expect(
      hoistedRepositories.bootstrapContextRepository.getContextBySessionId
    ).toHaveBeenCalledWith('paynote-unknown-bootstrap-session');
    expect(
      hoistedRepositories.bootstrapContextRepository
        .getBootstrapSessionIdByTargetSessionId
    ).toHaveBeenCalledWith('paynote-unknown-bootstrap-session');
    expect(
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock
    ).not.toHaveBeenCalled();
    expect(hoistedPaynotes.handleWebhookEventMock).not.toHaveBeenCalled();
  });

  it('allows unknown paynote delivery session through gate', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
      null
    );
    hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock.mockResolvedValue({
      handled: true,
      logs: [],
    });

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-delivery-unknown-session',
        object: {
          sessionId: 'delivery-unknown-1',
          document: {
            name: 'Delivery',
            type: { blueId: PAYNOTE_DELIVERY_BLUE_ID },
            contracts: {
              checkpoint: {
                lastEvents: {
                  merchantChannel: {
                    message: {
                      request:
                        buildSchemaShapedDocumentBootstrapRequestedNode(),
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-delivery-unknown-session',
      }),
      expect.any(Object)
    );
  });

  it('allows unknown bootstrap session through gate to enable buffering flow', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
      null
    );
    hoistedPaynotes.handlePayNoteBootstrapWebhookEventMock.mockResolvedValue({
      handled: true,
      logs: [],
    });

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-bootstrap-unknown-session',
        object: {
          sessionId: 'bootstrap-unknown-1',
          document: {
            name: 'Bootstrap',
            type: {
              blueId: myosBlueIds['MyOS/Document Session Bootstrap'],
            },
            initiatorSessionIds: {
              items: [{ value: 'delivery-canonical-1' }],
            },
            document: {
              type: { blueId: PAYNOTE_DELIVERY_BLUE_ID },
            },
          },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedPaynotes.handlePayNoteBootstrapWebhookEventMock
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-bootstrap-unknown-session',
      }),
      expect.any(Object)
    );
  });

  it('skips contract summary enqueue for non-canonical sessions', async () => {
    hoistedRepositories.contractRepository.getContractBySessionId.mockResolvedValue(
      null
    );

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-non-canonical',
        object: {
          sessionId: 'session-non-canonical',
          document: { type: { blueId: PAYNOTE_DELIVERY_BLUE_ID } },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedRepositories.contractRepository.getContractBySessionId
    ).toHaveBeenCalledWith('session-non-canonical');
    expect(hoistedRepositories.summaryInputStore.save).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Skipping contract-summary enqueue (no contract for session; non-canonical session?)',
      expect.objectContaining({
        eventId: 'event-non-canonical',
        sessionId: 'session-non-canonical',
      })
    );
  });

  it('skips contract summary enqueue when mapped session is not canonical', async () => {
    hoistedRepositories.contractRepository.getContractBySessionId.mockResolvedValue(
      {
        contractId: 'contract-1',
        sessionId: 'session-canonical',
      }
    );

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-linked-session',
        object: {
          sessionId: 'session-linked',
          document: { type: { blueId: PAYNOTE_DELIVERY_BLUE_ID } },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedRepositories.contractRepository.getContractBySessionId
    ).toHaveBeenCalledWith('session-linked');
    expect(hoistedRepositories.summaryInputStore.save).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Skipping contract-summary enqueue (session is not canonical)',
      expect.objectContaining({
        eventId: 'event-linked-session',
        sessionId: 'session-linked',
        canonicalSessionId: 'session-canonical',
        contractId: 'contract-1',
      })
    );
  });

  it('stores summary input snapshot for canonical sessions', async () => {
    hoistedRepositories.contractRepository.getContractBySessionId.mockResolvedValue(
      {
        contractId: 'contract-1',
        sessionId: 'session-canonical',
        documentId: 'document-1',
        updatedAt: '2026-02-08T00:00:00.000Z',
        document: { type: { blueId: PAYNOTE_DELIVERY_BLUE_ID } },
        emittedEvents: [
          {
            type: {
              blueId: paynoteBlueIds['PayNote/PayNote Cancelled'],
              name: 'PayNote Cancelled',
            },
          },
        ],
      }
    );

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-canonical',
        object: {
          sessionId: 'session-canonical',
          created: '2026-02-08T00:00:01.000Z',
          epoch: 3,
          document: { type: { blueId: PAYNOTE_DELIVERY_BLUE_ID } },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedRepositories.contractRepository.getContractBySessionId
    ).toHaveBeenCalledWith('session-canonical');
    expect(
      hoistedRepositories.contractRepository.markSummaryEventProcessed
    ).toHaveBeenCalledWith('event-canonical');
    expect(hoistedRepositories.summaryInputStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        sourceUpdatedAt: '2026-02-08T00:00:01.000Z',
        sourceEpoch: 3,
      })
    );

    const snapshot =
      hoistedRepositories.summaryInputStore.save.mock.calls[0]?.[0];
    const emittedEvents = snapshot?.contractSnapshot?.emittedEvents;
    expect(Array.isArray(emittedEvents)).toBe(true);
    expect((emittedEvents as { items?: unknown })?.items).toBeUndefined();
    expect(emittedEvents).toHaveLength(1);
  });

  it('stores synthetic source epoch -1 for DOCUMENT_CREATED summary jobs', async () => {
    hoistedRepositories.contractRepository.getContractBySessionId.mockResolvedValue(
      {
        contractId: 'contract-1',
        sessionId: 'session-canonical',
        documentId: 'document-1',
        updatedAt: '2026-02-08T00:00:00.000Z',
        document: { type: { blueId: PAYNOTE_DELIVERY_BLUE_ID } },
      }
    );

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-created',
        type: 'DOCUMENT_CREATED',
        object: {
          sessionId: 'session-canonical',
          created: '2026-02-08T00:00:01.000Z',
          document: { type: { blueId: PAYNOTE_DELIVERY_BLUE_ID } },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    expect(hoistedRepositories.summaryInputStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        sourceUpdatedAt: '2026-02-08T00:00:01.000Z',
        sourceEpoch: -1,
      })
    );
  });

  it('skips contract summary enqueue when webhook event was already processed', async () => {
    hoistedRepositories.contractRepository.getContractBySessionId.mockResolvedValue(
      {
        contractId: 'contract-1',
        sessionId: 'session-canonical',
        documentId: 'document-1',
        updatedAt: '2026-02-08T00:00:00.000Z',
        document: { type: { blueId: PAYNOTE_DELIVERY_BLUE_ID } },
      }
    );
    hoistedRepositories.contractRepository.markSummaryEventProcessed.mockResolvedValue(
      false
    );

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-duplicate',
        object: {
          sessionId: 'session-canonical',
          created: '2026-02-08T00:00:01.000Z',
          epoch: 3,
          document: { type: { blueId: PAYNOTE_DELIVERY_BLUE_ID } },
        },
      },
    } as any);

    expect(response.status).toBe(200);
    expect(
      hoistedRepositories.contractRepository.markSummaryEventProcessed
    ).toHaveBeenCalledWith('event-duplicate');
    expect(hoistedRepositories.summaryInputStore.save).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'Skipping contract-summary enqueue (event already processed)',
      expect.objectContaining({
        eventId: 'event-duplicate',
        sessionId: 'session-canonical',
        contractId: 'contract-1',
      })
    );
  });
});
