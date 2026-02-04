import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unarchiveContractHandler } from './unarchiveContract';
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

describe('unarchiveContractHandler', () => {
  const logger = {
    info: vi.fn(),
  };

  const contractRepository = {
    getContractBySessionId: vi.fn(),
    updateContractArchive: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    hoisted.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    contractRepository.getContractBySessionId.mockReset();
    contractRepository.updateContractArchive.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
    });

    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 404 when contract is missing', async () => {
    contractRepository.getContractBySessionId.mockResolvedValue(null);

    const response = await unarchiveContractHandler(
      {
        params: { sessionId: 'session-1' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(ERROR_CODES.CONTRACT_NOT_FOUND);
  });

  it('removes archivedAt for the current user', async () => {
    const now = new Date('2024-01-03T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    contractRepository.getContractBySessionId.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'type-1',
      displayName: 'PayNote',
      sessionId: 'session-1',
      userId: 'user-1',
      archivedAt: '2024-01-03T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });

    const response = await unarchiveContractHandler(
      {
        params: { sessionId: 'session-1' },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(contractRepository.updateContractArchive).toHaveBeenCalledWith({
      contractId: 'contract-1',
      archivedAt: null,
      updatedAt: now.toISOString(),
      userId: 'user-1',
      relatedTransactionIds: null,
      relatedHoldIds: null,
    });
    expect(response.body).toEqual({
      status: 'ok',
      myosStatus: 200,
    });
  });
});
