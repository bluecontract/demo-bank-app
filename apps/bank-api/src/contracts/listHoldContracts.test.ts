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
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    contractRepository.listContractsByHoldId.mockReset();
    payNoteDeliveryRepository.listDeliveriesByUserId.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
      payNoteDeliveryRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns related contracts for the hold', async () => {
    const { all: summaries, visible } = createContractSummaryFixtures();

    contractRepository.listContractsByHoldId.mockResolvedValue(summaries);
    payNoteDeliveryRepository.listDeliveriesByUserId.mockResolvedValue([
      {
        deliveryId: 'delivery-1',
        deliverySessionId: 'session-delivery-1',
        name: 'PayNote Delivery Proposal',
        amountMinor: 1200,
        currency: 'USD',
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

    const response = await listHoldContractsHandler(
      {
        params: { holdId: 'hold-123' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      ...visible,
      {
        deliveryId: 'delivery-1',
        deliverySessionId: 'session-delivery-1',
        name: 'PayNote Delivery Proposal',
        amountMinor: 1200,
        currency: 'USD',
        clientDecisionStatus: 'pending',
        holdId: 'hold-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        kind: 'proposal',
      },
      {
        deliveryId: 'delivery-2',
        deliverySessionId: 'session-delivery-2',
        name: 'Rejected Proposal',
        amountMinor: 800,
        currency: 'USD',
        clientDecisionStatus: 'rejected',
        holdId: 'hold-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        kind: 'proposal',
      },
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
