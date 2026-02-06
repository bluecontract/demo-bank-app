import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listPayNoteDeliveriesHandler } from './listPayNoteDeliveries';

const hoisted = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

vi.mock('./dependencies', () => ({
  getDependencies: hoisted.getDependenciesMock,
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoisted.extractAuthInfoMock,
}));

describe('listPayNoteDeliveriesHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const payNoteDeliveryRepository = {
    listDeliveriesByUserId: vi.fn(),
  };
  const merchantDirectoryRepository = {
    getMerchantsByIds: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    payNoteDeliveryRepository.listDeliveriesByUserId.mockReset();
    merchantDirectoryRepository.getMerchantsByIds.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      payNoteDeliveryRepository,
      merchantDirectoryRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns identified deliveries only', async () => {
    const merchantId = 'merchant-1';
    payNoteDeliveryRepository.listDeliveriesByUserId.mockResolvedValue([
      {
        deliveryId: 'delivery-1',
        transactionIdentificationStatus: 'identified',
        merchantId,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        deliveryId: 'delivery-2',
        transactionIdentificationStatus: 'failed',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        deliveryId: 'delivery-3',
        transactionIdentificationStatus: 'pending',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
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

    const response = await listPayNoteDeliveriesHandler({} as any, {
      request: {} as any,
    });

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        deliveryId: 'delivery-1',
        from: {
          merchantId,
          name: 'Blue Appliances',
          logoUrl: 'data:image/png;base64,abc',
        },
      }),
    ]);
    expect(logger.info).toHaveBeenCalledWith('Listing PayNote deliveries', {
      userId: 'user-1',
    });
  });

  it('filters by clientDecisionStatus when provided', async () => {
    payNoteDeliveryRepository.listDeliveriesByUserId.mockResolvedValue([
      {
        deliveryId: 'd1',
        deliverySessionId: 's1',
        transactionIdentificationStatus: 'identified',
        clientDecisionStatus: 'pending',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        deliveryId: 'd2',
        deliverySessionId: 's2',
        transactionIdentificationStatus: 'identified',
        clientDecisionStatus: 'accepted',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ]);

    const response = await listPayNoteDeliveriesHandler(
      { query: { clientDecisionStatus: 'pending' } } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      deliveryId: 'd1',
      clientDecisionStatus: 'pending',
    });
    expect(logger.info).toHaveBeenCalledWith('Listing PayNote deliveries', {
      userId: 'user-1',
      clientDecisionStatus: 'pending',
    });
  });
});
