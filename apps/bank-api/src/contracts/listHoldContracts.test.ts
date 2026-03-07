import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listHoldContractsHandler } from './listHoldContracts';
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

describe('listHoldContractsHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const contractRepository = {
    listContractsByHoldId: vi.fn(),
  };
  const payNoteDeliveryRepository = {
    listDeliveriesByUserId: vi.fn(),
    getDeliveryPollingMarkerByUserId: vi.fn(),
  };
  const merchantDirectoryRepository = {
    getMerchantsByIds: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    contractRepository.listContractsByHoldId.mockReset();
    payNoteDeliveryRepository.listDeliveriesByUserId.mockReset();
    merchantDirectoryRepository.getMerchantsByIds.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
      payNoteDeliveryRepository,
      merchantDirectoryRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns related contracts for the hold', async () => {
    const { all: summaries, visible } = createContractSummaryFixtures();
    const merchantId = 'merchant-1';
    summaries[0] = { ...summaries[0], merchantId };

    contractRepository.listContractsByHoldId.mockResolvedValue(summaries);
    payNoteDeliveryRepository.listDeliveriesByUserId.mockResolvedValue([
      {
        deliveryId: 'delivery-1',
        deliverySessionId: 'session-delivery-1',
        name: 'PayNote Delivery Proposal',
        amountMinor: 1200,
        currency: 'USD',
        merchantId,
        clientDecisionStatus: 'pending',
        holdId: 'hold-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
      {
        deliveryId: 'delivery-2',
        deliverySessionId: 'session-delivery-2',
        name: 'Rejected Proposal',
        amountMinor: 800,
        currency: 'USD',
        merchantId,
        clientDecisionStatus: 'rejected',
        holdId: 'hold-123',
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
        holdId: 'hold-999',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ]);
    merchantDirectoryRepository.getMerchantsByIds.mockResolvedValue([
      {
        merchantId,
        name: 'Blue Appliances',
        logoUrl: 'data:image/png;base64,abc',
        ownerUserId: 'owner-1',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ]);

    const response = await listHoldContractsHandler(
      {
        params: { holdId: 'hold-123' },
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
      expect.objectContaining({
        deliveryId: 'delivery-1',
        kind: 'proposal',
        from: {
          merchantId,
          name: 'Blue Appliances',
          logoUrl: 'data:image/png;base64,abc',
        },
      }),
      expect.objectContaining({
        deliveryId: 'delivery-2',
        kind: 'proposal',
        from: {
          merchantId,
          name: 'Blue Appliances',
          logoUrl: 'data:image/png;base64,abc',
        },
      }),
    ]);
    expect(contractRepository.listContractsByHoldId).toHaveBeenCalledWith(
      'hold-123',
      { userId: 'user-1' }
    );
    expect(
      payNoteDeliveryRepository.listDeliveriesByUserId
    ).toHaveBeenCalledWith('user-1');
    expect(logger.info).toHaveBeenCalledWith('Listing contracts for hold', {
      userId: 'user-1',
      holdId: 'hold-123',
    });
  });
});
