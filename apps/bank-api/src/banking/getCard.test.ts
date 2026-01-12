import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

import * as dependencies from './dependencies';
import * as banking from '@demo-bank-app/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { getCardHandler } from './getCard';
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

const mockCard = {
  cardId: 'card-123',
  accountId: 'acc-123',
  accountNumber: '1234567890',
  ownerUserId: TEST_USER_ID,
  cardholderName: 'Test User',
  panLast4: '4242',
  panHash: 'hash',
  cvcHash: 'cvc-hash',
  expiryMonth: 12,
  expiryYear: 2030,
  status: 'ACTIVE',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('getCardHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: {} as any,
      cardRepository: {} as any,
      cardHasher: {} as any,
      holdRepository: {} as any,
      accountNumberGenerator: {} as any,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
    });

    vi.spyOn(banking, 'getCard').mockResolvedValue(mockCard as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns masked card details', async () => {
    const response = await getCardHandler(
      {
        params: { cardId: 'card-123' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      cardId: 'card-123',
      accountId: 'acc-123',
      accountNumber: '1234567890',
      cardholderName: 'Test User',
      panLast4: '4242',
      expiryMonth: 12,
      expiryYear: 2030,
      status: 'ACTIVE',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('maps CardNotFoundError to 404', async () => {
    vi.mocked(banking.getCard).mockRejectedValueOnce(
      new banking.CardNotFoundError('card-123')
    );

    const response = await getCardHandler(
      {
        params: { cardId: 'card-123' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: ERROR_CODES.CARD_NOT_FOUND,
      message: 'Card not found',
    });
  });

  it('maps ForbiddenError to 403', async () => {
    vi.mocked(banking.getCard).mockRejectedValueOnce(
      new banking.ForbiddenError('Forbidden')
    );

    const response = await getCardHandler(
      {
        params: { cardId: 'card-123' },
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
