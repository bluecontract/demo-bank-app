import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listContractsHandler } from './listContracts';

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

describe('listContractsHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const contractRepository = {
    listContractsByUserId: vi.fn(),
    updateContractSummary: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    contractRepository.listContractsByUserId.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns contract summaries and forwards updatedSince', async () => {
    const updatedSince = '2024-01-02T10:00:00.000Z';
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

    contractRepository.listContractsByUserId.mockResolvedValue(summaries);

    const response = await listContractsHandler(
      {
        query: { updatedSince },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(summaries);
    expect(contractRepository.listContractsByUserId).toHaveBeenCalledWith(
      'user-1',
      { updatedSince }
    );
    expect(logger.info).toHaveBeenCalledWith('Listing contracts', {
      userId: 'user-1',
      updatedSince,
    });
  });
});
