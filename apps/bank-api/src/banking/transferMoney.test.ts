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
import { Money } from '@demo-bank-app/banking';
import type { SimpleAccountNumberGenerator } from '@demo-bank-app/banking';
import { ERROR_CODES } from '../shared/errors';
import { transferMoneyHandler } from './transferMoney';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
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
  getAccountIdByNumber: vi.fn(),
} as unknown as DynamoBankingRepository;

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

describe('transferMoneyHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
    });
    vi.spyOn(banking, 'transferMoney').mockResolvedValue('txn-123');
    vi.spyOn(mockRepository, 'getAccountIdByNumber').mockResolvedValue(
      minimalAccount.id
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const minimalAccount = {
    id: 'acc-2',
    accountNumber: '1234567890',
    ownerUserId: 'user-2',
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date(),
    ledgerBalanceMinor: 1000,
    availableBalanceMinor: 1000,
    balanceVersion: 1,
    postings: [],
    applyPosting: vi.fn(),
    isOwnedBy: vi.fn(() => true),
    ensureSufficientFunds: vi.fn(),
    ensureActive: vi.fn(),
  } as unknown as Account;

  it('should return 201 and txnId for valid transfer', async () => {
    const result = await transferMoneyHandler(
      {
        body: {
          sourceAccountId: minimalAccount.id,
          destinationAccountNumber: '1234567890',
          amountMinor: 100,
        },
        headers: { 'idempotency-key': 'idemp-1' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ txnId: 'txn-123' });
    expect(banking.transferMoney).toHaveBeenCalledWith(
      {
        srcAccountId: minimalAccount.id,
        dstAccountNumber: '1234567890',
        amountMinor: new Money(100),
        description: '',
        ctx: {
          idempotencyKey: 'idemp-1',
          userId: TEST_USER_ID,
        },
      },
      { repository: mockRepository }
    );
    expect(mockLogger.info).toHaveBeenCalledWith('Transferring money', {
      userId: TEST_USER_ID,
      sourceAccountId: minimalAccount.id,
      destinationAccountNumber: '1234567890',
      amountMinor: 100,
    });
    expect(mockLogger.info).toHaveBeenCalledWith('Money transferred', {
      userId: TEST_USER_ID,
      txnId: 'txn-123',
      sourceAccountId: minimalAccount.id,
      destinationAccountNumber: '1234567890',
      amountMinor: 100,
    });
  });

  it('should return 401 if JWT token is missing', async () => {
    const result = await expect(
      transferMoneyHandler(
        {
          body: {
            sourceAccountId: minimalAccount.id,
            destinationAccountNumber: '1234567890',
            amountMinor: 100,
          },
          headers: { 'idempotency-key': 'idemp-1' },
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
    const result = await transferMoneyHandler(
      {
        body: {
          sourceAccountId: minimalAccount.id,
          destinationAccountNumber: '1234567890',
          amountMinor: 100,
        },
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

  it('should return 404 if destination account not found', async () => {
    (banking.transferMoney as any).mockRejectedValueOnce(
      new banking.AccountNotFoundError('non-existent-account')
    );
    const result = await transferMoneyHandler(
      {
        body: {
          sourceAccountId: 'acc-1',
          destinationAccountNumber: 'non-existent-account',
          amountMinor: 100,
        },
        headers: { 'idempotency-key': 'idemp-1' },
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
    vi.spyOn(mockRepository, 'getAccountIdByNumber').mockResolvedValue(
      minimalAccount.id
    );
    (banking.transferMoney as any).mockRejectedValueOnce(
      new banking.ForbiddenError('forbidden')
    );
    const result = await transferMoneyHandler(
      {
        body: {
          sourceAccountId: 'acc-1',
          destinationAccountNumber: '1234567890',
          amountMinor: 100,
        },
        headers: { 'idempotency-key': 'idemp-1' },
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
    vi.spyOn(mockRepository, 'getAccountIdByNumber').mockResolvedValue(
      minimalAccount.id
    );
    (banking.transferMoney as any).mockRejectedValueOnce(
      new banking.InsufficientFundsError(100, 0)
    );
    const result = await transferMoneyHandler(
      {
        body: {
          sourceAccountId: 'acc-1',
          destinationAccountNumber: '1234567890',
          amountMinor: 100,
        },
        headers: { 'idempotency-key': 'idemp-1' },
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
    vi.spyOn(mockRepository, 'getAccountIdByNumber').mockResolvedValue(
      minimalAccount.id
    );
    (banking.transferMoney as any).mockRejectedValueOnce(new Error('fail'));
    await expect(
      transferMoneyHandler(
        {
          body: {
            sourceAccountId: 'acc-1',
            destinationAccountNumber: '1234567890',
            amountMinor: 100,
          },
          headers: { 'idempotency-key': 'idemp-1' },
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
