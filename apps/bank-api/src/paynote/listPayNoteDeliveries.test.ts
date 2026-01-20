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

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    payNoteDeliveryRepository.listDeliveriesByUserId.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      payNoteDeliveryRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns identified deliveries only', async () => {
    payNoteDeliveryRepository.listDeliveriesByUserId.mockResolvedValue([
      {
        deliveryId: 'delivery-1',
        transactionIdentificationStatus: 'identified',
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

    const response = await listPayNoteDeliveriesHandler({} as any, {
      request: {} as any,
    });

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({ deliveryId: 'delivery-1' }),
    ]);
    expect(logger.info).toHaveBeenCalledWith('Listing PayNote deliveries', {
      userId: 'user-1',
    });
  });
});
