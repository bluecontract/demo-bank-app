import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPayNoteDeliverySummaryHandler } from './getPayNoteDeliverySummary';
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

describe('getPayNoteDeliverySummaryHandler', () => {
  const payNoteDeliveryRepository = {
    getDeliveryBySessionId: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    payNoteDeliveryRepository.getDeliveryBySessionId.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      payNoteDeliveryRepository,
    });
    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns 404 for non-canonical sessions', async () => {
    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValue({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-canonical',
      deliverySessionIds: ['session-canonical', 'session-linked'],
      userId: 'user-1',
      summary: {
        story: {
          headline: 'PayNote proposal',
          overview: ['Summary'],
          bullets: [],
        },
        listPreview: 'PayNote proposal updated.',
        nextSteps: {
          title: 'Next steps',
          items: ['Review proposal'],
        },
        lastChange: {
          short: 'Updated',
          more: 'Updated details',
        },
      },
      summaryUpdatedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const response = await getPayNoteDeliverySummaryHandler(
      {
        params: { sessionId: 'session-linked' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND);
  });

  it('returns summary for canonical sessions', async () => {
    payNoteDeliveryRepository.getDeliveryBySessionId.mockResolvedValue({
      deliveryId: 'delivery-1',
      deliverySessionId: 'session-1',
      userId: 'user-1',
      summary: {
        story: {
          headline: 'PayNote proposal',
          overview: ['Summary'],
          bullets: [],
        },
        listPreview: 'PayNote proposal updated.',
        nextSteps: {
          title: 'Next steps',
          items: ['Review proposal'],
        },
        lastChange: {
          short: 'Updated',
          more: 'Updated details',
        },
      },
      summaryUpdatedAt: '2024-01-01T00:00:00.000Z',
      summarySourceUpdatedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const response = await getPayNoteDeliverySummaryHandler(
      {
        params: { sessionId: 'session-1' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        summaryUpdatedAt: '2024-01-01T00:00:00.000Z',
      })
    );
  });
});
