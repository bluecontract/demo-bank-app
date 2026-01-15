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
import { issueCardHandler } from './issueCard';
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
const mockCardHasher = {} as any;

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

const mockIssuedCard = {
  cardId: 'card-123',
  accountId: 'acc-123',
  accountNumber: '1234567890',
  ownerUserId: TEST_USER_ID,
  cardholderName: 'Test User',
  pan: '1234567890124242',
  cvc: '123',
  panLast4: '4242',
  panHash: 'hash',
  cvcHash: 'cvc-hash',
  expiryMonth: 12,
  expiryYear: 2030,
  status: 'ACTIVE',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockIssueResult = {
  card: mockIssuedCard,
  pan: '1234567890124242',
  cvc: '123',
};

describe('issueCardHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: mockRepository,
      cardRepository: mockCardRepository,
      cardHasher: mockCardHasher,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
      holdRepository: {} as any,
      accountNumberGenerator: {} as any,
    });

    vi.spyOn(banking, 'issueCard').mockResolvedValue(mockIssueResult as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns issued card details with PAN and CVC', async () => {
    const response = await issueCardHandler(
      {
        body: { accountId: 'acc-123', cardholderName: 'Test User' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(201);
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
      pan: '1234567890124242',
      cvc: '123',
    });

    expect(banking.issueCard).toHaveBeenCalledWith(
      {
        userId: TEST_USER_ID,
        accountId: 'acc-123',
        cardholderName: 'Test User',
        isTest: false,
      },
      expect.objectContaining({
        bankingRepository: mockRepository,
        cardRepository: mockCardRepository,
        cardHasher: mockCardHasher,
        binPrefix: '123456',
      })
    );
  });

  it('maps AccountNotFoundError to 404', async () => {
    vi.mocked(banking.issueCard).mockRejectedValueOnce(
      new banking.AccountNotFoundError('acc-123')
    );

    const response = await issueCardHandler(
      {
        body: { accountId: 'acc-123' },
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
    vi.mocked(banking.issueCard).mockRejectedValueOnce(
      new banking.ForbiddenError('Access denied')
    );

    const response = await issueCardHandler(
      {
        body: { accountId: 'acc-123' },
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

  it('maps CardIssuanceError to 500', async () => {
    vi.mocked(banking.issueCard).mockRejectedValueOnce(
      new banking.CardIssuanceError('issue failed')
    );

    const response = await issueCardHandler(
      {
        body: { accountId: 'acc-123' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: ERROR_CODES.CARD_ISSUANCE_FAILED,
      message: 'issue failed',
    });
  });
});
