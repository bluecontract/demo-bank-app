import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

import * as dependencies from './dependencies';
import * as banking from '@demo-bank-app/banking';
import type { DynamoBankingRepository } from '@demo-bank-app/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { Account, Money } from '@demo-bank-app/banking';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import type { SimpleAccountNumberGenerator } from '@demo-bank-app/banking';
import { setCreditLimitHandler } from './setCreditLimit';
import { ERROR_CODES } from '../shared/errors';

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

const mockAccount = new Account({
  id: 'acc-123',
  accountNumber: '1234567890',
  name: 'Merchant Credit Line',
  ownerUserId: 'user-1',
  status: 'ACTIVE',
  currency: 'USD',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  accountType: 'CREDIT_LINE',
  creditLimitMinor: new Money(1000),
  ledgerBalanceMinor: new Money(1000),
  availableBalanceMinor: new Money(1000),
  isTest: false,
  balanceVersion: 0,
});

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

describe('setCreditLimitHandler', () => {
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
    vi.spyOn(banking, 'setCreditLimit').mockResolvedValue(mockAccount);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return updated account on success', async () => {
    const result = await setCreditLimitHandler(
      {
        params: { accountId: mockAccount.id },
        body: { creditLimitMinor: 1500 },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      accountId: mockAccount.id,
      accountNumber: mockAccount.accountNumber,
      name: mockAccount.name,
      currency: mockAccount.currency,
      createdAt: mockAccount.createdAt.toISOString(),
      accountType: mockAccount.accountType,
      creditLimitMinor: mockAccount.creditLimitMinor?.toCents(),
      ledgerBalanceMinor: mockAccount.ledgerBalanceMinor.toCents(),
      availableBalanceMinor: mockAccount.availableBalanceMinor.toCents(),
      status: mockAccount.status,
    });
  });

  it('should return 404 for AccountNotFoundError', async () => {
    (banking.setCreditLimit as any).mockRejectedValueOnce(
      new banking.AccountNotFoundError('missing')
    );

    const result = await setCreditLimitHandler(
      {
        params: { accountId: 'missing' },
        body: { creditLimitMinor: 1000 },
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

  it('should return 400 for InvalidAccountError', async () => {
    (banking.setCreditLimit as any).mockRejectedValueOnce(
      new banking.InvalidAccountError('creditLimitMinor', 'Invalid limit')
    );

    const result = await setCreditLimitHandler(
      {
        params: { accountId: mockAccount.id },
        body: { creditLimitMinor: 1000 },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: ERROR_CODES.VALIDATION_ERROR,
      message: 'Account validation failed - creditLimitMinor: Invalid limit',
    });
  });

  it('should return 409 for OptimisticLockError', async () => {
    (banking.setCreditLimit as any).mockRejectedValueOnce(
      new banking.OptimisticLockError('account_balance_acc-123')
    );

    const result = await setCreditLimitHandler(
      {
        params: { accountId: mockAccount.id },
        body: { creditLimitMinor: 1500 },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: ERROR_CODES.ACCOUNT_CONFLICT,
      message: 'Account was updated concurrently. Please retry.',
    });
  });
});
