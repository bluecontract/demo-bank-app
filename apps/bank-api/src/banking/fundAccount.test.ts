import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

import * as dependencies from './dependencies';
import * as banking from '@demo-bank-app/banking';
import type { DynamoBankingRepository } from '@demo-bank-app/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { Account } from '@demo-bank-app/banking';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { Money } from '@demo-bank-app/banking';
import type { SimpleAccountNumberGenerator } from '@demo-bank-app/banking';
import { fundAccountHandler } from './fundAccount';
import { ERROR_CODES } from '../shared/errors';
import { UnauthorizedRequestError } from '../auth/errors';

const mockLogger: PowertoolsLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  addContext: vi.fn(),
  setCorrelationId: vi.fn(),
} as any;

const mockRepository = {
  saveAccount: vi.fn(async (account: Account) => account),
} as unknown as DynamoBankingRepository;

const mockCardRepository = {} as any;
const mockCardHasher = {} as any;
const mockHoldRepository = {} as any;

const mockAccountNumberGenerator = {
  generate: vi.fn(() => '1234567890'),
  counter: 0,
} as unknown as SimpleAccountNumberGenerator;

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
  defaultMerchantCreditLimitMinor: 500_000,
};

// Helper to generate a valid demoAuth JWT for tests
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

describe('fundAccountHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: mockRepository,
      cardRepository: mockCardRepository,
      cardHasher: mockCardHasher,
      holdRepository: mockHoldRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
    });
    vi.spyOn(banking, 'fundAccount').mockResolvedValue('txn-456');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const accountId = 'acc-123';
  const userId = 'user-1';
  const idempotencyKey = 'idemp-2';

  it('should return 201 and txnId for valid funding', async () => {
    const result = await fundAccountHandler(
      {
        params: { accountId },
        body: { amountMinor: 100 },
        headers: { 'idempotency-key': idempotencyKey },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ txnId: 'txn-456' });
    expect(banking.fundAccount).toHaveBeenCalledWith(
      {
        accountId,
        amountMinor: new Money(100),
        ctx: { userId, idempotencyKey },
      },
      { repository: mockRepository }
    );
    expect(mockLogger.debug).toHaveBeenCalledWith('Funding account', {
      userId,
      accountId,
      amountMinor: 100,
    });
    expect(mockLogger.debug).toHaveBeenCalledWith('Account funded', {
      userId,
      accountId,
      txnId: 'txn-456',
      amountMinor: 100,
    });
  });

  it('should return 401 if JWT token is missing', async () => {
    await expect(
      fundAccountHandler(
        {
          params: { accountId },
          body: { amountMinor: 100 },
          headers: { 'idempotency-key': idempotencyKey },
        },
        {
          request: {
            headers: new Headers(),
          } as unknown as MaybeAuthenticatedTsRestRequestContext,
        }
      )
    ).rejects.toThrow(
      new UnauthorizedRequestError(
        'Failed to extract auth info from the request'
      )
    );
  });

  it('should return 400 if Idempotency-Key is missing', async () => {
    const result = await fundAccountHandler(
      {
        params: { accountId },
        body: { amountMinor: 100 },
        headers: {} as unknown as { 'idempotency-key': string },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: ERROR_CODES.MISSING_IDEMPOTENCY_KEY,
      message: 'Idempotency-Key header is required',
    });
  });

  it('should return 404 if AccountNotFoundError thrown', async () => {
    (banking.fundAccount as any).mockRejectedValueOnce(
      new banking.AccountNotFoundError('non-existent-account')
    );
    const result = await fundAccountHandler(
      {
        params: { accountId },
        body: { amountMinor: 100 },
        headers: { 'idempotency-key': idempotencyKey },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );
    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: ERROR_CODES.ACCOUNT_NOT_FOUND,
      message: 'Account not found',
    });
  });

  it('should return 403 if ForbiddenError thrown', async () => {
    (banking.fundAccount as any).mockRejectedValueOnce(
      new banking.ForbiddenError('forbidden')
    );
    const result = await fundAccountHandler(
      {
        params: { accountId },
        body: { amountMinor: 100 },
        headers: { 'idempotency-key': idempotencyKey },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: ERROR_CODES.FORBIDDEN,
      message: 'Forbidden access',
    });
  });

  it('should return 400 if InsufficientFundsError thrown', async () => {
    (banking.fundAccount as any).mockRejectedValueOnce(
      new banking.InsufficientFundsError(100, 0)
    );
    const result = await fundAccountHandler(
      {
        params: { accountId },
        body: { amountMinor: 100 },
        headers: { 'idempotency-key': idempotencyKey },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: ERROR_CODES.INSUFFICIENT_FUNDS,
      message: 'Insufficient funds',
    });
  });

  it('should propagate unexpected errors', async () => {
    (banking.fundAccount as any).mockRejectedValueOnce(new Error('fail'));
    await expect(
      fundAccountHandler(
        {
          params: { accountId },
          body: { amountMinor: 100 },
          headers: { 'idempotency-key': idempotencyKey },
        },
        {
          request: {
            headers: setAuthHeader(new Headers()),
          } as unknown as MaybeAuthenticatedTsRestRequestContext,
        }
      )
    ).rejects.toThrow('fail');
  });
});
