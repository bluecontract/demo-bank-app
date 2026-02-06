import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPayNoteDeliveryBySessionIdHandler } from './getPayNoteDeliveryBySessionId';
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

describe('getPayNoteDeliveryBySessionIdHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const payNoteDeliveryRepository = {
    getDeliveryBySessionId: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    payNoteDeliveryRepository.getDeliveryBySessionId.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      payNoteDeliveryRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns 404 when delivery is missing or not visible', async () => {
    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValue(null);

    const response = await getPayNoteDeliveryBySessionIdHandler(
      { params: { sessionId: 'session-1' } } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND);
  });

  it('returns sanitized details without raw documents', async () => {
    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValue({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      transactionIdentificationStatus: 'identified',
      clientDecisionStatus: 'pending',
      summary: {
        story: {
          headline: 'PayNote proposal',
          overview: ['A proposal summary.'],
          bullets: [],
        },
        listPreview: 'PayNote proposal updated.',
        nextSteps: {
          title: 'Next steps',
          items: ['Review the proposal.'],
        },
        lastChange: {
          short: 'PayNote proposal updated.',
          more: 'Details updated.',
        },
      },
      summaryUpdatedAt: '2024-01-01T00:00:00.000Z',
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
      payNoteDocument: {
        name: 'Raw PayNote',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const response = await getPayNoteDeliveryBySessionIdHandler(
      { params: { sessionId: 'session-1' } } as any,
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
    expect('deliveryDocument' in response.body).toBe(false);
    expect('payNoteDocument' in response.body).toBe(false);
  });
});
