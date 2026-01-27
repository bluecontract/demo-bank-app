import { describe, it, expect, vi } from 'vitest';
import { getPayNoteDetails } from './getPayNoteDetails';
import type {
  BankingFacade,
  BlueIdCalculator,
  ClockPort,
  PayNoteDeliveryRepository,
  PayNoteRepository,
} from '../ports';

describe('getPayNoteDetails', () => {
  const createDependencies = () => {
    const bankingFacade: BankingFacade = {
      getAccountForUser: vi.fn().mockResolvedValue({
        id: 'account-id',
        accountNumber: '1234567890',
      }),
      getAccountByNumber: vi.fn(),
      transferFunds: vi.fn(),
      reserveFunds: vi.fn(),
      captureHold: vi.fn().mockResolvedValue({
        holdId: 'hold-1',
      }),
    };

    const payNoteRepository: PayNoteRepository = {
      getPayNote: vi.fn().mockResolvedValue({
        payNoteDocumentId: 'doc-1',
        accountNumber: '1234567890',
        userId: 'user-123',
        document: { payerAccountNumber: { value: '1234567890' } },
        transactionRequest: [],
        triggerEvent: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      }),
      getPayNoteBySessionId: vi.fn(),
      savePayNote: vi.fn(),
    };

    const payNoteDeliveryRepository: PayNoteDeliveryRepository = {
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn().mockResolvedValue(null),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
      markEventProcessed: vi.fn(),
    };

    const blueIdCalculator: BlueIdCalculator = {
      fromObject: vi.fn(),
      fromYaml: vi.fn(),
      toReversedJson: vi.fn((value: unknown) => value),
    };

    const clock: ClockPort = {
      now: () => new Date('2024-01-01T00:00:00.000Z'),
    };

    return {
      bankingFacade,
      payNoteRepository,
      payNoteDeliveryRepository,
      blueIdCalculator,
      clock,
    };
  };

  it('returns account-not-found when user has no account', async () => {
    const deps = createDependencies();
    vi.mocked(deps.bankingFacade.getAccountForUser).mockResolvedValueOnce(null);

    const result = await getPayNoteDetails(
      {
        accountNumber: '1234567890',
        payNoteDocumentId: 'doc-1',
        userId: 'user-123',
      },
      deps
    );

    expect(result.type).toBe('account-not-found');
  });

  it('returns paynote-not-found when record is missing', async () => {
    const deps = createDependencies();
    vi.mocked(deps.payNoteRepository.getPayNote).mockResolvedValueOnce(null);
    vi.mocked(
      deps.payNoteDeliveryRepository.getDeliveryByDocumentId
    ).mockResolvedValueOnce(null);

    const result = await getPayNoteDetails(
      {
        accountNumber: '1234567890',
        payNoteDocumentId: 'doc-missing',
        userId: 'user-123',
      },
      deps
    );

    expect(result.type).toBe('paynote-not-found');
  });

  it('returns success when delivery record exists for document id', async () => {
    const deps = createDependencies();
    vi.mocked(deps.payNoteRepository.getPayNote).mockResolvedValueOnce(null);
    vi.mocked(
      deps.payNoteDeliveryRepository.getDeliveryByDocumentId
    ).mockResolvedValueOnce({
      deliveryId: 'delivery-1',
      deliveryDocumentId: 'doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      deliveryDocument: {
        payNoteBootstrapRequest: { document: { name: 'Delivery PayNote' } },
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await getPayNoteDetails(
      {
        accountNumber: '1234567890',
        payNoteDocumentId: 'doc-1',
        userId: 'user-123',
      },
      deps
    );

    expect(result.type).toBe('success');
  });

  it('returns success when record is found', async () => {
    const deps = createDependencies();

    const result = await getPayNoteDetails(
      {
        accountNumber: '1234567890',
        payNoteDocumentId: 'doc-1',
        userId: 'user-123',
      },
      deps
    );

    if (result.type !== 'success') {
      throw new Error('Expected success result');
    }

    expect(result.detail.payNoteDocumentId).toBe('doc-1');
  });
});
