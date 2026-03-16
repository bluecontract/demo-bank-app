import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import * as dependencies from './dependencies';
import * as banking from '@demo-bank-app/banking';
import type {
  DynamoBankingRepository,
  DynamoHoldRepository,
} from '@demo-bank-app/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { listAccountActivityHandler } from './activity';
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

const mockMetrics: PowertoolsMetrics = {
  addMetric: vi.fn(),
  addMetadata: vi.fn(),
  publishStoredMetrics: vi.fn(),
  setDefaultDimensions: vi.fn(),
} as any;

const mockRepository = {} as DynamoBankingRepository;
const mockHoldRepository = {} as DynamoHoldRepository;
const mockConfig = {
  cardConfig: {
    cardBinPrefix: '123456',
    cardProcessorToken: 'processor-token',
  },
  defaultMerchantCreditLimitMinor: 500_000,
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

describe('listAccountActivityHandler', () => {
  beforeEach(() => {
    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: mockRepository,
      cardRepository: {} as any,
      cardHasher: {} as any,
      holdRepository: mockHoldRepository,
      accountNumberGenerator: {} as any,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
    });

    vi.spyOn(banking, 'listAccountActivity').mockResolvedValue({
      items: [
        {
          kind: 'HOLD_CREATED' as const,
          activityId: 'HOLD#hold-123',
          holdId: 'hold-123',
          amountMinor: 5_000,
          createdAt: '2024-01-02T00:00:00.000Z',
        },
        {
          kind: 'HOLD_RELEASED' as const,
          activityId: 'HOLD#hold-123',
          holdId: 'hold-123',
          amountMinor: 5_000,
          releasedAt: '2024-01-02T02:00:00.000Z',
          releaseReason: 'Customer request',
        },
        {
          kind: 'POSTED_TRANSACTION' as const,
          activityId: 'TXN#txn-123',
          transactionId: 'txn-123',
          amountMinor: 5_000,
          postedAt: '2024-01-02T03:00:00.000Z',
          originHoldId: 'hold-123',
          side: 'CREDIT',
          type: 'FUNDING',
          status: 'POSTED',
          counterpartyAccountNumber: '9999999999',
        },
      ],
      nextToken: 'cursor-token',
      hasMore: true,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns merged activity items for authenticated user', async () => {
    const result = await listAccountActivityHandler(
      {
        params: { accountNumber: '1234567890' },
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
          kind: 'HOLD_CREATED',
          activityId: 'HOLD#hold-123',
          holdId: 'hold-123',
          amountMinor: 5_000,
          description: undefined,
          createdAt: '2024-01-02T00:00:00.000Z',
          counterpartyAccountNumber: undefined,
          createdByUserId: undefined,
          idempotencyKeyHash: undefined,
          cardId: undefined,
          cardLast4: undefined,
          merchantName: undefined,
          merchantId: undefined,
          merchantStatementDescriptor: undefined,
          processorChargeId: undefined,
        },
        {
          kind: 'HOLD_RELEASED',
          activityId: 'HOLD#hold-123',
          holdId: 'hold-123',
          amountMinor: 5_000,
          description: undefined,
          releasedAt: '2024-01-02T02:00:00.000Z',
          releaseReason: 'Customer request',
          cardId: undefined,
          cardLast4: undefined,
          merchantName: undefined,
          merchantId: undefined,
          merchantStatementDescriptor: undefined,
          processorChargeId: undefined,
        },
        {
          kind: 'POSTED_TRANSACTION',
          activityId: 'TXN#txn-123',
          transactionId: 'txn-123',
          amountMinor: 5_000,
          description: undefined,
          postedAt: '2024-01-02T03:00:00.000Z',
          originHoldId: 'hold-123',
          side: 'CREDIT',
          type: 'FUNDING',
          status: 'POSTED',
          counterpartyAccountNumber: '9999999999',
          cardId: undefined,
          cardLast4: undefined,
          merchantName: undefined,
          merchantId: undefined,
          merchantStatementDescriptor: undefined,
          processorChargeId: undefined,
        },
      ],
      nextCursor: 'cursor-token',
    });

    expect(banking.listAccountActivity).toHaveBeenCalledWith(
      {
        userId: TEST_USER_ID,
        accountNumber: '1234567890',
        limit: 10,
        cursor: 'cursor-token',
      },
      {
        bankingRepository: mockRepository,
        holdRepository: mockHoldRepository,
        logger: mockLogger,
      }
    );
  });

  it('translates AccountNotFoundError to 404 response', async () => {
    vi.spyOn(banking, 'listAccountActivity').mockRejectedValue(
      new banking.AccountNotFoundError('1234567890')
    );

    const response = await listAccountActivityHandler(
      {
        params: { accountNumber: '1234567890' },
        query: {},
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.ACCOUNT_NOT_FOUND,
    });
  });

  it('translates InvalidActivityCursorError to 400 response', async () => {
    vi.spyOn(banking, 'listAccountActivity').mockRejectedValue(
      new banking.InvalidActivityCursorError('bad cursor')
    );

    const response = await listAccountActivityHandler(
      {
        params: { accountNumber: '1234567890' },
        query: { cursor: 'bad' },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.VALIDATION_ERROR,
      message: 'bad cursor',
    });
  });

  it('throws for unauthorized requests when JWT missing', async () => {
    await expect(
      listAccountActivityHandler(
        {
          params: { accountNumber: '1234567890' },
          query: {},
        },
        {
          request: {
            headers: new Headers(),
          } as unknown as MaybeAuthenticatedTsRestRequestContext,
        }
      )
    ).rejects.toBeInstanceOf(UnauthorizedRequestError);
  });
});
