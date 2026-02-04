import { describe, it, expect, vi } from 'vitest';
import { handleWebhookEvent } from './handleWebhookEvent';
import type { HandleWebhookEventDependencies } from './handleWebhookEvent';
import type { MyOsFetchEventResult, MyOsFetchDocumentResult } from '../ports';

const createDependencies = () => {
  const fetchEvent = vi
    .fn<HandleWebhookEventDependencies['myOsClient']['fetchEvent']>()
    .mockResolvedValue({
      kind: 'success',
      payload: {
        object: {
          document: { type: 'PayNote/PayNote' },
          sessionId: 'session-1',
        },
      },
    } as MyOsFetchEventResult);

  const fetchDocument = vi
    .fn<HandleWebhookEventDependencies['myOsClient']['fetchDocument']>()
    .mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: { type: 'PayNote/PayNote' },
      },
    } as MyOsFetchDocumentResult);

  const myOsClient: HandleWebhookEventDependencies['myOsClient'] = {
    getCredentials: vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'https://example.test',
    }),
    bootstrapDocument: vi.fn(),
    runDocumentOperation: vi.fn(),
    fetchEvent,
    fetchDocument,
  };

  const bankingFacade: HandleWebhookEventDependencies['bankingFacade'] = {
    getAccountByNumber: vi.fn().mockResolvedValue({
      id: 'account-id',
      accountNumber: '1234567890',
      ownerUserId: 'user-123',
    }),
    getAccountForUser: vi.fn(),
    transferFunds: vi.fn(),
    reserveFunds: vi.fn(),
    captureHold: vi.fn().mockResolvedValue({
      holdId: 'hold-1',
    }),
  };

  const payNoteRepository: HandleWebhookEventDependencies['payNoteRepository'] =
    {
      getPayNote: vi.fn().mockResolvedValue(null),
      getPayNoteBySessionId: vi.fn().mockResolvedValue(null),
      savePayNote: vi.fn(),
    };

  const holdRepository: HandleWebhookEventDependencies['holdRepository'] = {
    getHold: vi.fn().mockResolvedValue(null),
    getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
    disableHoldCapture: vi.fn().mockResolvedValue(null),
    enableHoldCapture: vi.fn().mockResolvedValue(null),
  } as any;

  const payNoteDeliveryRepository: HandleWebhookEventDependencies['payNoteDeliveryRepository'] =
    {
      markEventProcessed: vi.fn(),
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
      updateDeliverySummary: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
    };

  const contractRepository: HandleWebhookEventDependencies['contractRepository'] =
    {
      getContract: vi.fn().mockResolvedValue(null),
      getContractBySessionId: vi.fn().mockResolvedValue(null),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
      addContractHistoryEntry: vi.fn(),
      listContractHistory: vi.fn(),
      updateContractArchive: vi.fn(),
      updateContractSummary: vi.fn(),
      listContractsByUserId: vi.fn(),
      listContractsByTransactionId: vi.fn(),
      listContractsByHoldId: vi.fn(),
    };

  const clock = { now: () => new Date('2024-01-01T00:00:00.000Z') };

  return {
    deps: {
      myOsClient,
      bankingFacade,
      holdRepository,
      payNoteRepository,
      payNoteDeliveryRepository,
      contractRepository,
      clock,
    } satisfies HandleWebhookEventDependencies,
    fetchEvent,
    fetchDocument,
  };
};

describe('handleWebhookEvent', () => {
  it('returns error note when event not found', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'not-found',
      status: 404,
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('Failed to download PayNote event from MyOS');
    expect(result.logs[0]?.level).toBe('error');
  });

  it('stores paynote record when payload resolves', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Test PayNote',
          },
          emitted: [],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(Array.isArray(result.logs)).toBe(true);
    expect(deps.bankingFacade.getAccountByNumber).toHaveBeenCalled();
    expect(deps.payNoteRepository.savePayNote).toHaveBeenCalledWith(
      expect.objectContaining({
        payNoteDocumentId: 'doc-1',
        payerAccountNumber: '1234567890',
      })
    );
  });

  it('adds transaction relationship after capture hold succeeds', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
          },
          emitted: [
            {
              type: { name: 'PayNote/Capture Funds Requested' },
              amount: { value: 1200 },
            },
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);

    deps.bankingFacade.captureHold = vi.fn().mockResolvedValue({
      holdId: 'doc-1',
      relatedTransactionId: 'txn-1',
    } as any);

    await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(deps.contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedTransactionIds: ['txn-1'],
      })
    );
  });

  it('handles card transaction capture lock request without payer account', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: { type: 'PayNote/PayNote', name: 'Slow Digestion PayNote' },
          emitted: [
            {
              type: { name: 'PayNote/Card Transaction Capture Lock Requested' },
              cardTransactionDetails: {
                authorizationCode: { value: 'AUTH01' },
              },
            },
          ],
        },
      },
    } as MyOsFetchEventResult);

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.holdRepository.getHold as any).mockResolvedValue({
      holdId: 'hold-1',
      payerAccountNumber: '955',
      amountMinor: 12000,
      currency: 'USD',
      status: 'PENDING',
      cardTransactionDetails: {
        retrievalReferenceNumber: '111111111111',
        systemTraceAuditNumber: '222222',
        transmissionDateTime: '0101000000',
        authorizationCode: 'AUTH01',
      },
      captureDisabled: false,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.holdRepository.disableHoldCapture as any).mockResolvedValue({
      holdId: 'hold-1',
      payerAccountNumber: '955',
      amountMinor: 12000,
      currency: 'USD',
      status: 'PENDING',
      cardTransactionDetails: {
        retrievalReferenceNumber: '111111111111',
        systemTraceAuditNumber: '222222',
        transmissionDateTime: '0101000000',
        authorizationCode: 'AUTH01',
      },
      captureDisabled: true,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.getAccountByNumber).not.toHaveBeenCalled();
    expect(deps.holdRepository.disableHoldCapture).toHaveBeenCalledWith(
      'hold-1'
    );
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'confirmCardTransactionCaptureLocked',
      })
    );
  });

  it('transfers funds when capture immediately is requested', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Quick PayNote',
          },
          emitted: [
            {
              type: {
                name: 'PayNote/Reserve Funds and Capture Immediately Requested',
              },
              amount: { value: 2500 },
            },
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);

    await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(deps.bankingFacade.transferFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccountId: 'account-id',
        destinationAccountNumber: '9876543210',
        amountMinor: 2500,
        description: 'Quick PayNote',
        userId: 'user-123',
        payNoteDocumentId: 'doc-1',
      })
    );
  });

  it('ignores card transaction capture lock request when details mismatch', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: { type: 'PayNote/PayNote', name: 'Slow Digestion PayNote' },
          emitted: [
            {
              type: { name: 'PayNote/Card Transaction Capture Lock Requested' },
              cardTransactionDetails: {
                authorizationCode: { value: 'AUTH99' },
              },
            },
          ],
        },
      },
    } as MyOsFetchEventResult);

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.holdRepository.getHold as any).mockResolvedValue({
      holdId: 'hold-1',
      payerAccountNumber: '955',
      amountMinor: 12000,
      currency: 'USD',
      status: 'PENDING',
      cardTransactionDetails: {
        retrievalReferenceNumber: '111111111111',
        systemTraceAuditNumber: '222222',
        transmissionDateTime: '0101000000',
        authorizationCode: 'AUTH01',
      },
      captureDisabled: false,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.holdRepository.disableHoldCapture).not.toHaveBeenCalled();
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
  });
});
