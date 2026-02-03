import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listTransactionContractsHandler } from './listTransactionContracts';
import { createContractSummaryFixtures } from './contractSummaryFixtures';

const hoisted = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

vi.mock('../paynote/dependencies', () => ({
  getDependencies: hoisted.getDependenciesMock,
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoisted.extractAuthInfoMock,
}));

describe('listTransactionContractsHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const contractRepository = {
    listContractsByTransactionId: vi.fn(),
  };
  const payNoteDeliveryRepository = {
    listDeliveriesByUserId: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    contractRepository.listContractsByTransactionId.mockReset();
    payNoteDeliveryRepository.listDeliveriesByUserId.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
      payNoteDeliveryRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns related contracts for the transaction', async () => {
    const { all: summaries, visible } = createContractSummaryFixtures();

    contractRepository.listContractsByTransactionId.mockResolvedValue(
      summaries
    );
    payNoteDeliveryRepository.listDeliveriesByUserId.mockResolvedValue([
      {
        deliveryId: 'delivery-1',
        deliverySessionId: 'session-delivery-1',
        name: 'PayNote Delivery Proposal',
        amountMinor: 1200,
        currency: 'USD',
        clientDecisionStatus: 'pending',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
      {
        deliveryId: 'delivery-2',
        deliverySessionId: 'session-delivery-2',
        name: 'Rejected Proposal',
        amountMinor: 800,
        currency: 'USD',
        clientDecisionStatus: 'rejected',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
      {
        deliveryId: 'delivery-3',
        deliverySessionId: 'session-delivery-3',
        name: 'Other Delivery',
        amountMinor: 2000,
        currency: 'USD',
        clientDecisionStatus: 'pending',
        transactionId: 'txn-999',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ]);

    const response = await listTransactionContractsHandler(
      {
        params: { txnId: 'txn-123' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      ...visible,
      {
        deliveryId: 'delivery-1',
        deliverySessionId: 'session-delivery-1',
        name: 'PayNote Delivery Proposal',
        amountMinor: 1200,
        currency: 'USD',
        clientDecisionStatus: 'pending',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        kind: 'proposal',
      },
      {
        deliveryId: 'delivery-2',
        deliverySessionId: 'session-delivery-2',
        name: 'Rejected Proposal',
        amountMinor: 800,
        currency: 'USD',
        clientDecisionStatus: 'rejected',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        kind: 'proposal',
      },
    ]);
    expect(
      contractRepository.listContractsByTransactionId
    ).toHaveBeenCalledWith('txn-123', { userId: 'user-1' });
    expect(
      payNoteDeliveryRepository.listDeliveriesByUserId
    ).toHaveBeenCalledWith('user-1');
    expect(logger.info).toHaveBeenCalledWith(
      'Listing contracts for transaction',
      {
        userId: 'user-1',
        transactionId: 'txn-123',
      }
    );
  });
});
