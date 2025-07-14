import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

import * as dependencies from './dependencies';
import * as banking from '@demo-blue/banking';
import type { DynamoBankingRepository } from '@demo-blue/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-blue/shared-observability';
import { Account } from '@demo-blue/banking';
import { createAccountHandler } from './createAccount';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { Money } from '@demo-blue/banking';
import type { SimpleAccountNumberGenerator } from '@demo-blue/banking';
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

describe('createAccountHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
    });
    vi.spyOn(banking, 'createAccount').mockResolvedValue(
      new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Savings Account',
        ownerUserId: 'user-1',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        ledgerBalanceMinor: new Money(0),
        availableBalanceMinor: new Money(0),
        isTest: false,
        balanceVersion: 0,
      })
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create account and return 201 with account data', async () => {
    const result = await createAccountHandler(
      { body: { name: 'My Savings Account' } },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );
    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      accountId: mockAccount.id,
      accountNumber: mockAccount.accountNumber,
      name: 'My Savings Account',
      currency: mockAccount.currency,
      createdAt: mockAccount.createdAt.toISOString(),
      ledgerBalanceMinor: 0,
      availableBalanceMinor: 0,
      status: mockAccount.status,
    });
    expect(banking.createAccount).toHaveBeenCalledWith(
      {
        ownerId: TEST_USER_ID,
        name: 'My Savings Account',
        isTest: false,
      },
      {
        repository: mockRepository,
        accountNumberGenerator: mockAccountNumberGenerator,
      }
    );
    expect(mockLogger.info).toHaveBeenCalledWith('Creating new account', {
      userId: TEST_USER_ID,
      name: 'My Savings Account',
    });
    expect(mockLogger.info).toHaveBeenCalledWith('Account created', {
      userId: TEST_USER_ID,
      accountId: mockAccount.id,
      name: 'My Savings Account',
    });
  });

  it('should return 401 if JWT token is missing', async () => {
    await expect(
      createAccountHandler(
        { body: { name: 'My Account' } },
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

  it('should propagate error if createAccount throws', async () => {
    (banking.createAccount as any).mockRejectedValueOnce(new Error('fail'));
    await expect(
      createAccountHandler(
        { body: { name: 'My Account' } },
        {
          request: {
            headers: setAuthHeader(new Headers()),
          } as unknown as MaybeAuthenticatedTsRestRequestContext,
        }
      )
    ).rejects.toThrow('fail');
  });
});
