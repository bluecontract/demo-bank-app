import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listTransactionContractsHandler } from './listTransactionContracts';

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

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    contractRepository.listContractsByTransactionId.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns related contracts for the transaction', async () => {
    const summaries = [
      {
        contractId: 'contract-1',
        typeBlueId: 'type-1',
        displayName: 'PayNote',
        sessionId: 'session-1',
        status: 'accepted',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T12:00:00.000Z',
      },
    ];

    contractRepository.listContractsByTransactionId.mockResolvedValue(
      summaries
    );

    const response = await listTransactionContractsHandler(
      {
        params: { txnId: 'txn-123' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(summaries);
    expect(
      contractRepository.listContractsByTransactionId
    ).toHaveBeenCalledWith('txn-123', { userId: 'user-1' });
    expect(logger.info).toHaveBeenCalledWith(
      'Listing contracts for transaction',
      {
        userId: 'user-1',
        transactionId: 'txn-123',
      }
    );
  });
});
