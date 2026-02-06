import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listContractsHandler } from './listContracts';
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

describe('listContractsHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const contractRepository = {
    listContractsByUserId: vi.fn(),
  };
  const merchantDirectoryRepository = {
    getMerchantsByIds: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    contractRepository.listContractsByUserId.mockReset();
    merchantDirectoryRepository.getMerchantsByIds.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
      merchantDirectoryRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns contract summaries and forwards updatedSince', async () => {
    const updatedSince = '2024-01-02T10:00:00.000Z';
    const { all: summaries, visible } = createContractSummaryFixtures();

    const merchantId = 'merchant-1';
    summaries[0] = { ...summaries[0], merchantId };
    merchantDirectoryRepository.getMerchantsByIds.mockResolvedValue([
      {
        merchantId,
        name: 'Blue Appliances',
        logoUrl: 'data:image/png;base64,abc',
        ownerUserId: 'owner-1',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ]);

    contractRepository.listContractsByUserId.mockResolvedValue(summaries);

    const response = await listContractsHandler(
      {
        query: { updatedSince },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        contractId: visible[0].contractId,
        from: {
          merchantId,
          name: 'Blue Appliances',
          logoUrl: 'data:image/png;base64,abc',
        },
      }),
    ]);
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
