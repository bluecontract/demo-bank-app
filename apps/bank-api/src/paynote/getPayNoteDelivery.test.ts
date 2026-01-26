import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPayNoteDeliveryHandler } from './getPayNoteDelivery';
import { ERROR_CODES } from '../shared/errors';

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

describe('getPayNoteDeliveryHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const payNoteDeliveryRepository = {
    getDelivery: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    payNoteDeliveryRepository.getDelivery.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      payNoteDeliveryRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns 404 when delivery is missing or not visible', async () => {
    payNoteDeliveryRepository.getDelivery.mockResolvedValue(null);

    const response = await getPayNoteDeliveryHandler(
      { params: { deliveryId: 'delivery-1' } } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND);
  });

  it('returns delivery details when identified for user', async () => {
    payNoteDeliveryRepository.getDelivery.mockResolvedValue({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      clientDecisionStatus: 'pending',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123',
        systemTraceAuditNumber: '456',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      deliveryDocument: {
        name: 'Merchant Delivery',
        payNoteBootstrapRequest: {
          document: {
            name: 'Invoice 42',
            amount: { total: 1200 },
            currency: 'USD',
          },
        },
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const response = await getPayNoteDeliveryHandler(
      { params: { deliveryId: 'delivery-1' } } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        deliverySessionId: 'session-1',
        transactionIdentificationStatus: 'identified',
        clientDecisionStatus: 'pending',
        payNote: {
          name: 'Invoice 42',
          amountMinor: 1200,
          currency: 'USD',
        },
      })
    );
  });
});
