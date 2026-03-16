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
import type { SimpleAccountNumberGenerator } from '@demo-bank-app/banking';
import { getTransactionHandler } from './getTransaction';
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

describe('getTransactionHandler', () => {
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

    const mockPosting = {
      accountId: 'acc-123',
      side: 'DEBIT' as const,
      amount: {
        toCents: () => 1000,
      },
      counterpartyAccountNumber: '0987654321',
    };

    const mockTransaction = {
      id: 'txn-123',
      type: 'TRANSFER' as const,
      status: 'POSTED' as const,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      description: 'Test transaction',
      postings: [mockPosting],
      validateDoubleEntry: vi.fn(),
      equals: vi.fn(() => true),
    } as unknown as import('@demo-bank-app/banking').Transaction;

    vi.spyOn(banking, 'getTransaction').mockResolvedValue(mockTransaction);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 200 with transaction details for authenticated user', async () => {
    const accountId = 'acc-123';
    const txnId = 'txn-123';
    const result = await getTransactionHandler(
      {
        params: { accountId, txnId },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      txnId: 'txn-123',
      type: 'TRANSFER',
      status: 'POSTED',
      description: 'Test transaction',
      accountId: 'acc-123',
      side: 'DEBIT',
      amountMinor: 1000,
      timestamp: '2024-01-01T00:00:00.000Z',
      counterpartyAccountNumber: '0987654321',
    });

    expect(banking.getTransaction).toHaveBeenCalledWith(
      {
        userId: TEST_USER_ID,
        accountId,
        transactionId: txnId,
      },
      { repository: mockRepository }
    );

    expect(mockLogger.debug).toHaveBeenCalledWith('Getting transaction', {
      userId: TEST_USER_ID,
      accountId,
      txnId,
    });
  });

  it('should include merchantId when present on the transaction', async () => {
    const accountId = 'acc-123';
    const txnId = 'txn-merchant';
    const mockPosting = {
      accountId,
      side: 'DEBIT' as const,
      amount: {
        toCents: () => 2500,
      },
      counterpartyAccountNumber: '5555555555',
    };

    const mockTransaction = {
      id: txnId,
      type: 'TRANSFER' as const,
      status: 'POSTED' as const,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      description: 'Merchant transaction',
      postings: [mockPosting],
      merchantId: 'merchant-42',
    } as unknown as import('@demo-bank-app/banking').Transaction;

    vi.mocked(banking.getTransaction).mockResolvedValueOnce(mockTransaction);

    const result = await getTransactionHandler(
      {
        params: { accountId, txnId },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      txnId,
      type: 'TRANSFER',
      status: 'POSTED',
      description: 'Merchant transaction',
      accountId,
      side: 'DEBIT',
      amountMinor: 2500,
      timestamp: '2024-01-01T00:00:00.000Z',
      counterpartyAccountNumber: '5555555555',
      merchantId: 'merchant-42',
    });
  });

  it('should return 401 if JWT token is missing', async () => {
    await expect(
      getTransactionHandler(
        {
          params: { accountId: 'acc-123', txnId: 'txn-123' },
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
    (banking.getTransaction as any).mockRejectedValueOnce(
      new banking.AccountNotFoundError('txn-123')
    );

    const result = await getTransactionHandler(
      {
        params: { accountId: 'acc-123', txnId: 'txn-123' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      error: ERROR_CODES.TRANSACTION_NOT_FOUND,
      message: 'Account txn-123 not found',
    });
  });

  it('should propagate unexpected errors', async () => {
    (banking.getTransaction as any).mockRejectedValueOnce(new Error('fail'));

    await expect(
      getTransactionHandler(
        {
          params: { accountId: 'acc-123', txnId: 'txn-123' },
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
