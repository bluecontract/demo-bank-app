import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computePollingDiff,
  decodePollingCursor,
  encodePollingCursor,
  pollChangesHandler,
} from './pollChanges';

const hoisted = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
  listAccountActivityMock: vi.fn(),
}));

vi.mock('../paynote/dependencies', () => ({
  getDependencies: hoisted.getDependenciesMock,
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoisted.extractAuthInfoMock,
}));

vi.mock('@demo-bank-app/banking', async () => {
  const actual = await vi.importActual('@demo-bank-app/banking');
  return {
    ...(actual as object),
    listAccountActivity: hoisted.listAccountActivityMock,
  };
});

describe('pollChanges helpers', () => {
  it('encodes and decodes polling cursor payload', () => {
    const cursor = encodePollingCursor({
      revision: 7,
      latestUpdatedAt: '2026-03-06T10:00:00.000Z',
    });

    expect(decodePollingCursor(cursor)).toEqual({
      revision: 7,
      latestUpdatedAt: '2026-03-06T10:00:00.000Z',
    });
  });

  it('marks changed when revision changes', () => {
    const previousCursor = encodePollingCursor({
      revision: 1,
      latestUpdatedAt: '2026-03-06T10:00:00.000Z',
    });

    const diff = computePollingDiff(
      { revision: 2, latestUpdatedAt: '2026-03-06T11:00:00.000Z' },
      previousCursor
    );

    expect(diff.changed).toBe(true);
    expect(diff.latestUpdatedAt).toBe('2026-03-06T11:00:00.000Z');
  });
});

describe('pollChangesHandler', () => {
  const logger = {
    debug: vi.fn(),
  };

  const contractRepository = {
    getContractPollingMarkerByUserId: vi.fn(),
  };

  const payNoteDeliveryRepository = {
    getDeliveryPollingMarkerByUserId: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
      payNoteDeliveryRepository,
      bankingRepository: {},
      holdRepository: {},
    });
    hoisted.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('returns 400 when includeActivity=true and account number is missing', async () => {
    const response = await pollChangesHandler(
      {
        query: {
          includeActivity: true,
        },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
      })
    );
  });

  it('returns contracts/proposals polling summaries', async () => {
    contractRepository.getContractPollingMarkerByUserId.mockResolvedValue({
      revision: 4,
      latestUpdatedAt: '2026-03-06T10:00:00.000Z',
    });
    payNoteDeliveryRepository.getDeliveryPollingMarkerByUserId.mockResolvedValue(
      {
        revision: 3,
        latestUpdatedAt: '2026-03-06T10:30:00.000Z',
      }
    );

    const response = await pollChangesHandler(
      {
        query: {
          includeContracts: true,
          includeProposals: true,
        },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body.contracts).toEqual(
      expect.objectContaining({
        changed: false,
        latestUpdatedAt: '2026-03-06T10:00:00.000Z',
      })
    );
    expect(response.body.proposals).toEqual(
      expect.objectContaining({
        changed: false,
        latestUpdatedAt: '2026-03-06T10:30:00.000Z',
      })
    );
  });

  it('returns 400 when contractsCursor is invalid', async () => {
    contractRepository.getContractPollingMarkerByUserId.mockResolvedValue({
      revision: 0,
    });
    payNoteDeliveryRepository.getDeliveryPollingMarkerByUserId.mockResolvedValue(
      {
        revision: 0,
      }
    );

    const response = await pollChangesHandler(
      {
        query: {
          contractsCursor: 'invalid-cursor',
        },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
      })
    );
  });

  it('returns activity marker when includeActivity=true', async () => {
    contractRepository.getContractPollingMarkerByUserId.mockResolvedValue({
      revision: 0,
    });
    payNoteDeliveryRepository.getDeliveryPollingMarkerByUserId.mockResolvedValue(
      {
        revision: 0,
      }
    );
    hoisted.listAccountActivityMock.mockResolvedValue({
      items: [
        {
          kind: 'POSTED_TRANSACTION',
          activityId: 'TXN#1',
          postedAt: '2026-03-06T12:00:00.000Z',
        },
      ],
      nextToken: undefined,
    });

    const response = await pollChangesHandler(
      {
        query: {
          includeActivity: true,
          activityAccountNumber: '1234567890',
        },
      } as any,
      { request: {} as any }
    );

    expect(response.status).toBe(200);
    expect(response.body.activity).toEqual(
      expect.objectContaining({
        accountNumber: '1234567890',
        changed: false,
        latestActivityAt: '2026-03-06T12:00:00.000Z',
      })
    );
  });
});
