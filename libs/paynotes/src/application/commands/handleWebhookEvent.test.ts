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
    getCredentials: vi.fn(),
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
    captureHold: vi.fn(),
  };

  const payNoteRepository: HandleWebhookEventDependencies['payNoteRepository'] =
    {
      getPayNote: vi.fn().mockResolvedValue(null),
      getPayNoteBySessionId: vi.fn().mockResolvedValue(null),
      savePayNote: vi.fn(),
    };

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
      listDeliveriesByUserId: vi.fn(),
    };

  const contractRepository: HandleWebhookEventDependencies['contractRepository'] =
    {
      getContract: vi.fn().mockResolvedValue(null),
      getContractBySessionId: vi.fn().mockResolvedValue(null),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
      saveContract: vi.fn(),
      updateContractSummary: vi.fn(),
      listContractsByUserId: vi.fn(),
    };

  const clock = { now: () => new Date('2024-01-01T00:00:00.000Z') };

  return {
    deps: {
      myOsClient,
      bankingFacade,
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
});
