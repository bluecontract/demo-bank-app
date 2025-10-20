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
import { getAccountHandler } from './getAccount';
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

const mockAccountNumberGenerator = {
  generate: vi.fn(() => '1234567890'),
  counter: 0,
} as unknown as SimpleAccountNumberGenerator;

const mockAccount = new Account({
  id: 'acc-123',
  accountNumber: '1234567890',
  name: 'Test Account',
  ownerUserId: 'user-1',
  status: 'ACTIVE',
  currency: 'USD',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
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

const mockConfig = {};

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

describe('getAccountHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
    });
    vi.spyOn(banking, 'getAccount').mockResolvedValue(mockAccount);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return account with correct balance', async () => {
    const result = await getAccountHandler(
      { params: { accountId: mockAccount.id } },
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
      ledgerBalanceMinor: mockAccount.ledgerBalanceMinor.toCents(),
      availableBalanceMinor: mockAccount.availableBalanceMinor.toCents(),
      status: mockAccount.status,
    });
  });

  it('should return 401 if JWT token is missing', async () => {
    await expect(
      getAccountHandler(
        { params: { accountId: mockAccount.id } },
        {
          request: {
            headers: new Headers(),
          } as unknown as MaybeAuthenticatedTsRestRequestContext,
        }
      )
    ).rejects.toThrow('Failed to extract auth info from the request');
  });

  it('should return 404 if AccountNotFoundError thrown', async () => {
    (banking.getAccount as any).mockRejectedValueOnce(
      new banking.AccountNotFoundError('not-existent-account')
    );
    const result = await getAccountHandler(
      { params: { accountId: mockAccount.id } },
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

  it('should propagate unexpected errors', async () => {
    (banking.getAccount as any).mockRejectedValueOnce(new Error('fail'));
    await expect(
      getAccountHandler(
        { params: { accountId: mockAccount.id } },
        {
          request: {
            headers: setAuthHeader(new Headers()),
          } as unknown as MaybeAuthenticatedTsRestRequestContext,
        }
      )
    ).rejects.toThrow('fail');
  });
});
