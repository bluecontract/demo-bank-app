import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

import * as dependencies from './dependencies';
import * as banking from '@demo-bank-app/banking';
import type { DynamoBankingRepository } from '@demo-bank-app/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { listCardsHandler } from './listCards';
import { ERROR_CODES } from '../shared/errors';

const mockLogger: PowertoolsLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  addContext: vi.fn(),
  setCorrelationId: vi.fn(),
} as any;

const mockMetrics = {
  addMetric: vi.fn(),
  addMetadata: vi.fn(),
  publishStoredMetrics: vi.fn(),
  setDefaultDimensions: vi.fn(),
} as unknown as PowertoolsMetrics;

const mockRepository = {} as DynamoBankingRepository;
const mockCardRepository = {} as any;

const mockConfig = {
  cardConfig: {
    cardBinPrefix: '123456',
    cardProcessorToken: 'processor-token',
  },
};

const TEST_JWT_SECRET = 'test-secret';
const TEST_USER_ID = 'user-1';
const TEST_JWT = jwt.sign(
  { sub: TEST_USER_ID, isTest: false },
  TEST_JWT_SECRET
);

const setAuthHeader = (headers: Headers) => {
  headers.set('cookie', `demoAuth=${TEST_JWT}`);
  return headers;
};

const mockCards = [
  {
    cardId: 'card-1',
    accountId: 'acc-1',
    accountNumber: '1234567890',
    cardholderName: 'Test User',
    panLast4: '1111',
    expiryMonth: 12,
    expiryYear: 2030,
    status: 'ACTIVE',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    cardId: 'card-2',
    accountId: 'acc-1',
    accountNumber: '1234567890',
    cardholderName: 'Test User',
    panLast4: '2222',
    expiryMonth: 1,
    expiryYear: 2031,
    status: 'ACTIVE',
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
];

describe('listCardsHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: mockRepository,
      cardRepository: mockCardRepository,
      cardHasher: {} as any,
      holdRepository: {} as any,
      accountNumberGenerator: {} as any,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
    });

    vi.spyOn(banking, 'listCards').mockResolvedValue(mockCards as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns card list for authenticated user', async () => {
    const response = await listCardsHandler(
      {
        query: { accountId: 'acc-1' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cards: mockCards });
    expect(banking.listCards).toHaveBeenCalledWith(
      {
        userId: TEST_USER_ID,
        accountId: 'acc-1',
      },
      {
        bankingRepository: mockRepository,
        cardRepository: mockCardRepository,
      }
    );
  });

  it('maps AccountNotFoundError to 404', async () => {
    vi.mocked(banking.listCards).mockRejectedValueOnce(
      new banking.AccountNotFoundError('acc-1')
    );

    const response = await listCardsHandler(
      {
        query: { accountId: 'acc-1' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: ERROR_CODES.ACCOUNT_NOT_FOUND,
      message: 'Account not found',
    });
  });

  it('maps ForbiddenError to 403', async () => {
    vi.mocked(banking.listCards).mockRejectedValueOnce(
      new banking.ForbiddenError('Forbidden')
    );

    const response = await listCardsHandler(
      {
        query: { accountId: 'acc-1' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: ERROR_CODES.FORBIDDEN,
      message: 'Forbidden access',
    });
  });
});
