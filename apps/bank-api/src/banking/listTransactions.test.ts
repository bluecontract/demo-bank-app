import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

import * as dependencies from './dependencies';
import * as banking from '@demo-blue/banking';
import type {
  DynamoBankingRepository,
  TransactionSummary,
} from '@demo-blue/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-blue/shared-observability';
import { Account } from '@demo-blue/banking';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { Money } from '@demo-blue/banking';
import type { SimpleAccountNumberGenerator } from '@demo-blue/banking';
import { listAccountsHandler } from './listAccounts';
import { listTransactionsHandler } from './listTransactions';
import { UnauthorizedRequestError } from '../auth/errors';
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

describe('listTransactionsHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
    });

    const mockTransactionSummary = {
      transactionId: 'txn-123',
      type: 'TRANSFER' as const,
      status: 'POSTED' as const,
      amount: new Money(1000),
      side: 'DEBIT' as const,
      description: 'Test transaction',
      destinationAccountNumber: '0987654321',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      counterpartyAccountNumber: '0987654321',
    };

    vi.spyOn(banking, 'listTransactions').mockResolvedValue({
      items: [mockTransactionSummary],
      nextToken: 'next-token',
      hasMore: true,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 200 with transaction list for authenticated user', async () => {
    const accountId = 'acc-123';
    const result = await listTransactionsHandler(
      {
        params: { accountId },
        query: { limit: 10, cursor: 'cursor-token' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      items: [
        {
          txnId: 'txn-123',
          accountId: accountId,
          side: 'DEBIT',
          amountMinor: 1000,
          type: 'TRANSFER',
          status: 'POSTED',
          timestamp: '2024-01-01T00:00:00.000Z',
          description: 'Test transaction',
          counterpartyAccountNumber: '0987654321',
        },
      ],
      next: 'next-token',
    });

    expect(banking.listTransactions).toHaveBeenCalledWith(
      {
        userId: TEST_USER_ID,
        accountId,
        pagination: {
          limit: 10,
          nextToken: 'cursor-token',
        },
      },
      { repository: mockRepository }
    );

    expect(mockLogger.info).toHaveBeenCalledWith('Listing transactions', {
      userId: TEST_USER_ID,
      accountId,
    });
  });

  it('should return 401 if JWT token is missing', async () => {
    await expect(
      listTransactionsHandler(
        {
          params: { accountId: 'acc-123' },
          query: {},
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

  it('should return 404 if AccountNotFoundError thrown', async () => {
    (banking.listTransactions as any).mockRejectedValueOnce(
      new banking.AccountNotFoundError('acc-123')
    );

    const result = await listTransactionsHandler(
      {
        params: { accountId: 'acc-123' },
        query: {},
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      error: ERROR_CODES.ACCOUNT_NOT_FOUND,
      message: 'Account acc-123 not found',
    });
  });

  it('should propagate unexpected errors', async () => {
    (banking.listTransactions as any).mockRejectedValueOnce(new Error('fail'));

    await expect(
      listTransactionsHandler(
        {
          params: { accountId: 'acc-123' },
          query: {},
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
