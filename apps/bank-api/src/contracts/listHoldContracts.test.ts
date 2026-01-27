import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listHoldContractsHandler } from './listHoldContracts';

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

describe('listHoldContractsHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const contractRepository = {
    listContractsByHoldId: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    contractRepository.listContractsByHoldId.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns related contracts for the hold', async () => {
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

    contractRepository.listContractsByHoldId.mockResolvedValue(summaries);

    const response = await listHoldContractsHandler(
      {
        params: { holdId: 'hold-123' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(summaries);
    expect(contractRepository.listContractsByHoldId).toHaveBeenCalledWith(
      'hold-123',
      { userId: 'user-1' }
    );
    expect(logger.info).toHaveBeenCalledWith('Listing contracts for hold', {
      userId: 'user-1',
      holdId: 'hold-123',
    });
  });
});
