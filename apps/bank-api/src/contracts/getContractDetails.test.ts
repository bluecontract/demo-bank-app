import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getContractDetailsHandler } from './getContractDetails';
import { ERROR_CODES } from '../shared/errors';

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

describe('getContractDetailsHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const contractRepository = {
    getContractBySessionId: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    contractRepository.getContractBySessionId.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns 404 when contract is missing', async () => {
    contractRepository.getContractBySessionId.mockResolvedValue(null);

    const response = await getContractDetailsHandler(
      {
        params: { sessionId: 'session-1' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(ERROR_CODES.CONTRACT_NOT_FOUND);
  });

  it('returns 404 when contract belongs to another user', async () => {
    contractRepository.getContractBySessionId.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'type-1',
      displayName: 'PayNote',
      sessionId: 'session-1',
      userId: 'user-2',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });

    const response = await getContractDetailsHandler(
      {
        params: { sessionId: 'session-1' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(ERROR_CODES.CONTRACT_NOT_FOUND);
  });

  it('returns contract details for the current user', async () => {
    contractRepository.getContractBySessionId.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'type-1',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      status: 'accepted',
      statusUpdatedAt: '2024-01-02T00:00:00.000Z',
      statusTimestamps: { acceptedAt: '2024-01-02T00:00:00.000Z' },
      relatedTransactionIds: ['txn-1'],
      relatedHoldIds: ['hold-1'],
      accountNumber: '1234567890',
      document: { name: 'Test PayNote' },
      summary: {
        story: {
          headline: 'PayNote updated',
          overview: ['A contract summary.'],
          bullets: [],
        },
        listPreview: 'PayNote updated.',
        nextSteps: {
          title: 'Next steps',
          items: ['Review the contract details.'],
        },
        lastChange: {
          short: 'PayNote updated.',
          more: 'The contract was updated.',
        },
      },
      summaryUpdatedAt: '2024-01-02T00:00:01.000Z',
      userId: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });

    const response = await getContractDetailsHandler(
      {
        params: { sessionId: 'session-1' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        contractId: 'contract-1',
        displayName: 'PayNote',
        sessionId: 'session-1',
        relatedTransactionIds: ['txn-1'],
      })
    );
  });
});
