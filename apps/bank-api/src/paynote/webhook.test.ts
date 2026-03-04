import { describe, it, expect, beforeEach, vi } from 'vitest';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import myosBlueIds from '@blue-repository/types/packages/myos/blue-ids';
import { PAYNOTE_DELIVERY_BLUE_ID } from '@demo-bank-app/paynotes';
import { payNoteWebhookHandler } from './webhook';

const hoistedDeps = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  createResolveMerchantOwnerUserIdMock: vi.fn(),
  createResolveMerchantNameByIdMock: vi.fn(),
}));

const hoistedPaynotes = vi.hoisted(() => ({
  handlePayNoteDeliveryWebhookEventMock: vi.fn(),
  handleWebhookEventMock: vi.fn(),
}));

const hoistedRepositories = vi.hoisted(() => ({
  contractRepository: null as any,
  summaryInputStore: null as any,
  bootstrapContextRepository: null as any,
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
  hoistedPaynotes.handleWebhookEventMock = vi.fn(actual.handleWebhookEvent);
  return {
    ...actual,
    handlePayNoteDeliveryWebhookEvent:
      hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock,
    handleWebhookEvent: hoistedPaynotes.handleWebhookEventMock,
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
    hoistedPaynotes.handleWebhookEventMock.mockClear();
    hoistedPaynotes.handlePayNoteDeliveryWebhookEventMock.mockResolvedValue({
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
      markSummaryEventProcessed: vi.fn().mockResolvedValue(true),
      saveContract: vi.fn(),
      updateContractSummary: vi.fn(),
      listContractsByUserId: vi.fn(),
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
    hoistedRepositories.contractRepository = contractRepository;
    hoistedRepositories.summaryInputStore = summaryInputStore;
    hoistedRepositories.bootstrapContextRepository = bootstrapContextRepository;

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
        markEventProcessed: vi.fn(),
        getDelivery: vi.fn(),
        getDeliveryByDocumentId: vi.fn(),
        getDeliveryBySessionId: vi.fn(),
        getDeliveryByBootstrapSessionId: vi.fn(),
        getDeliveryByPayNoteDocumentId: vi.fn(),
        getDeliveryByCardTransactionDetails: vi.fn(),
        saveDelivery: vi.fn(),
        listDeliveriesByUserId: vi.fn(),
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

  it('throws for unknown non-synchrony paynote session after retry', async () => {
    vi.useFakeTimers();
    try {
      hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
        null
      );
      hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
        null
      );

      const handlerPromise = payNoteWebhookHandler({
        body: {
          id: 'event-unknown-session',
          object: {
            sessionId: 'unknown-session-1',
            document: {
              name: 'Unknown Document',
              type: { blueId: paynoteBlueIds['PayNote/PayNote'] },
            },
          },
        },
      } as any);

      const rejectionAssertion = expect(handlerPromise).rejects.toThrow(
        'Unknown webhook session "unknown-session-1" (no bootstrap context mapping)'
      );
      await vi.advanceTimersByTimeAsync(6_000);
      await rejectionAssertion;
      expect(
        hoistedRepositories.bootstrapContextRepository.getContextBySessionId
      ).toHaveBeenCalledTimes(4);
      expect(
        hoistedRepositories.bootstrapContextRepository
          .getBootstrapSessionIdByTargetSessionId
      ).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows unknown paynote delivery session through gate', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
      null
    );

    const response = await payNoteWebhookHandler({
      body: {
        id: 'event-delivery-unknown-session',
        object: {
          sessionId: 'delivery-unknown-1',
          document: {
            name: 'Delivery',
            type: { blueId: PAYNOTE_DELIVERY_BLUE_ID },
          },
        },
      },
    } as any);

    expect(response.status).toBe(200);
  });

  it('allows unknown bootstrap session through gate to enable buffering flow', async () => {
    hoistedRepositories.bootstrapContextRepository.getContextBySessionId.mockResolvedValue(
      null
    );
    hoistedRepositories.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId.mockResolvedValue(
      null
    );

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
          },
        },
      },
    } as any);

    expect(response.status).toBe(200);
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
