import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

import * as dependencies from './dependencies';
import { getActivityDetailHandler } from './getActivityDetail';
import type {
  DynamoBankingRepository,
  DynamoHoldRepository,
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/banking';
import { Account, Money, type HoldEvent } from '@demo-bank-app/banking';
import { ERROR_CODES } from '../shared/errors';
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

const mockMetrics: PowertoolsMetrics = {
  addMetric: vi.fn(),
  addMetadata: vi.fn(),
  publishStoredMetrics: vi.fn(),
  setDefaultDimensions: vi.fn(),
} as any;

const repositoryMock = {
  getAccountIdByNumber: vi.fn(),
  getAccountById: vi.fn(),
  getTransactionById: vi.fn(),
};

const holdRepositoryMock = {
  getHold: vi.fn(),
  listHoldEvents: vi.fn(),
};

const mockRepository = repositoryMock as unknown as DynamoBankingRepository;
const mockHoldRepository =
  holdRepositoryMock as unknown as DynamoHoldRepository;

const mockConfig = {};

const TEST_JWT_SECRET = 'test-secret';
const TEST_USER_ID = 'user-1';
const TEST_JWT = jwt.sign(
  { sub: TEST_USER_ID, isTest: false },
  TEST_JWT_SECRET
);

const baseAccount = new Account({
  id: 'acc-123',
  accountNumber: '1234567890',
  name: 'Checking',
  ownerUserId: TEST_USER_ID,
  status: 'ACTIVE',
  currency: 'USD',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  ledgerBalanceMinor: new Money(10_000),
  availableBalanceMinor: new Money(10_000),
  balanceVersion: 1,
});

const setAuthHeader = (headers: Headers) => {
  headers.set('cookie', `demoAuth=${TEST_JWT}`);
  return headers;
};

describe('getActivityDetailHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(dependencies, 'getDependencies').mockResolvedValue({
      repository: mockRepository,
      holdRepository: mockHoldRepository,
      logger: mockLogger,
      metrics: mockMetrics,
      config: mockConfig,
      accountNumberGenerator: {} as any,
    });

    vi.mocked(repositoryMock.getAccountIdByNumber).mockResolvedValue(
      baseAccount.id
    );
    vi.mocked(repositoryMock.getAccountById).mockResolvedValue(baseAccount);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns transaction activity detail for owned account', async () => {
    const transactionId = 'txn-123';
    const mockPosting = {
      accountId: baseAccount.id,
      side: 'DEBIT' as const,
      amountMinor: 2500,
      counterpartyAccountNumber: '0987654321',
    } as any;

    const mockTransaction = {
      id: transactionId,
      type: 'TRANSFER' as const,
      status: 'POSTED' as const,
      description: 'Test transaction',
      createdAt: new Date('2024-01-02T00:00:00.000Z'),
      postings: [mockPosting],
      originHoldId: 'hold-789',
    } as any;

    vi.mocked(repositoryMock.getTransactionById).mockResolvedValue(
      mockTransaction
    );

    const response = await getActivityDetailHandler(
      {
        params: {
          accountNumber: baseAccount.accountNumber,
          activityId: `TXN#${transactionId}`,
        },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      kind: 'POSTED_TRANSACTION',
      activityId: `TXN#${transactionId}`,
      transactionId,
      amountMinor: 2500,
      description: 'Test transaction',
      postedAt: '2024-01-02T00:00:00.000Z',
      originHoldId: 'hold-789',
      side: 'DEBIT',
      type: 'TRANSFER',
      status: 'POSTED',
      counterpartyAccountNumber: '0987654321',
    });

    expect(repositoryMock.getTransactionById).toHaveBeenCalledWith(
      transactionId
    );
  });

  it('includes PayNote metadata when transaction is linked', async () => {
    const transactionId = 'txn-paynote';
    const mockPosting = {
      accountId: baseAccount.id,
      side: 'DEBIT' as const,
      amountMinor: 5_000,
      counterpartyAccountNumber: '1111222233',
    } as any;

    const mockTransaction = {
      id: transactionId,
      type: 'TRANSFER' as const,
      status: 'POSTED' as const,
      description: 'PayNote transfer',
      createdAt: new Date('2024-01-10T00:00:00.000Z'),
      postings: [mockPosting],
      payNoteEventId: 'event-abc',
    } as any;

    vi.mocked(repositoryMock.getTransactionById).mockResolvedValue(
      mockTransaction
    );

    const response = await getActivityDetailHandler(
      {
        params: {
          accountNumber: baseAccount.accountNumber,
          activityId: `TXN#${transactionId}`,
        },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      kind: 'POSTED_TRANSACTION',
      payNote: { myosEventId: 'event-abc' },
    });
  });

  it('supports url-safe activity id format for transactions', async () => {
    const transactionId = 'txn-456';
    const mockPosting = {
      accountId: baseAccount.id,
      side: 'CREDIT' as const,
      amountMinor: 1000,
      counterpartyAccountNumber: '0000000000',
    } as any;

    const mockTransaction = {
      id: transactionId,
      type: 'FUNDING' as const,
      status: 'POSTED' as const,
      description: 'Funding transaction',
      createdAt: new Date('2024-01-05T00:00:00.000Z'),
      postings: [mockPosting],
    } as any;

    vi.mocked(repositoryMock.getTransactionById).mockResolvedValue(
      mockTransaction
    );

    const response = await getActivityDetailHandler(
      {
        params: {
          accountNumber: baseAccount.accountNumber,
          activityId: `TXN--${transactionId}`,
        },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      kind: 'POSTED_TRANSACTION',
      activityId: `TXN#${transactionId}`,
      transactionId,
    });
  });

  it('returns hold activity detail with timeline', async () => {
    const holdId = 'hold-123';
    const hold = {
      holdId,
      payerAccountNumber: baseAccount.accountNumber,
      amountMinor: 5_000,
      currency: 'USD' as const,
      status: 'PENDING' as const,
      description: 'Test hold',
      createdAt: '2024-01-03T10:00:00.000Z',
      expiresAt: '2024-01-05T10:00:00.000Z',
      releasedAt: undefined,
      releaseReason: undefined,
      counterpartyAccountNumber: '1234567899',
    } as any;

    const events: HoldEvent[] = [
      {
        type: 'CREATED',
        at: '2024-01-03T10:00:00.000Z',
        createdByUserId: 'system',
        idempotencyKeyHash: 'hash-1',
      },
      {
        type: 'CAPTURED',
        at: '2024-01-04T09:00:00.000Z',
        transactionId: 'txn-555',
        counterpartyAccountNumber: '1234567899',
      },
    ];

    vi.mocked(holdRepositoryMock.getHold).mockResolvedValue(hold);
    vi.mocked(holdRepositoryMock.listHoldEvents).mockResolvedValue(events);

    const response = await getActivityDetailHandler(
      {
        params: {
          accountNumber: baseAccount.accountNumber,
          activityId: `HOLD#${holdId}`,
        },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      kind: 'HOLD',
      activityId: `HOLD#${holdId}`,
      holdId,
      amountMinor: 5_000,
      currency: 'USD',
      status: 'PENDING',
      description: 'Test hold',
      createdAt: '2024-01-03T10:00:00.000Z',
      expiresAt: '2024-01-05T10:00:00.000Z',
      releasedAt: undefined,
      releaseReason: undefined,
      capturedAt: '2024-01-04T09:00:00.000Z',
      captureTransactionId: 'txn-555',
      failedAt: undefined,
      failureCode: undefined,
      failureMessage: undefined,
      counterpartyAccountNumber: '1234567899',
      timeline: [
        {
          type: 'CREATED',
          at: '2024-01-03T10:00:00.000Z',
          createdByUserId: 'system',
          idempotencyKeyHash: 'hash-1',
          payNoteEventId: undefined,
        },
        {
          type: 'CAPTURED',
          at: '2024-01-04T09:00:00.000Z',
          transactionId: 'txn-555',
          counterpartyAccountNumber: '1234567899',
          payNoteEventId: undefined,
        },
      ],
    });
  });

  it('includes PayNote metadata when hold is linked', async () => {
    const holdId = 'hold-paynote';

    const events: HoldEvent[] = [
      {
        type: 'CREATED',
        at: '2024-01-02T00:00:00.000Z',
        payNoteEventId: 'event-hold-123',
      },
    ];

    vi.mocked(holdRepositoryMock.getHold).mockResolvedValue({
      holdId,
      payerAccountNumber: baseAccount.accountNumber,
      amountMinor: 12_000,
      currency: 'USD' as const,
      status: 'PENDING' as const,
      description: 'PayNote hold',
      createdAt: '2024-01-02T00:00:00.000Z',
      payNoteEventId: 'event-hold-123',
    });

    vi.mocked(holdRepositoryMock.listHoldEvents).mockResolvedValue(events);

    const response = await getActivityDetailHandler(
      {
        params: {
          accountNumber: baseAccount.accountNumber,
          activityId: `HOLD#${holdId}`,
        },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe('HOLD');
    expect(response.body.payNote).toBeUndefined();
    expect(response.body.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'CREATED',
          payNoteEventId: 'event-hold-123',
        }),
      ])
    );
  });

  it('supports url-safe activity id format for holds', async () => {
    const holdId = 'hold-789';
    const hold = {
      holdId,
      payerAccountNumber: baseAccount.accountNumber,
      amountMinor: 1_000,
      currency: 'USD' as const,
      status: 'PENDING' as const,
      description: 'Url safe hold',
      createdAt: '2024-01-06T10:00:00.000Z',
    } as any;

    vi.mocked(holdRepositoryMock.getHold).mockResolvedValue(hold);
    vi.mocked(holdRepositoryMock.listHoldEvents).mockResolvedValue([
      {
        type: 'CREATED',
        at: '2024-01-06T10:00:00.000Z',
      } as HoldEvent,
    ]);

    const response = await getActivityDetailHandler(
      {
        params: {
          accountNumber: baseAccount.accountNumber,
          activityId: `HOLD--${holdId}`,
        },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      kind: 'HOLD',
      activityId: `HOLD#${holdId}`,
      holdId,
    });
  });

  it('returns 404 when activity does not belong to account', async () => {
    const transactionId = 'txn-888';
    const mockPosting = {
      accountId: 'other-account',
      side: 'DEBIT' as const,
      amountMinor: 1000,
      counterpartyAccountNumber: '0000000000',
    } as any;

    const mockTransaction = {
      id: transactionId,
      type: 'TRANSFER' as const,
      status: 'POSTED' as const,
      description: 'Foreign transaction',
      createdAt: new Date('2024-01-02T00:00:00.000Z'),
      postings: [mockPosting],
    } as any;

    vi.mocked(repositoryMock.getTransactionById).mockResolvedValue(
      mockTransaction
    );

    const response = await getActivityDetailHandler(
      {
        params: {
          accountNumber: baseAccount.accountNumber,
          activityId: `TXN#${transactionId}`,
        },
      },
      {
        request: {
          headers: setAuthHeader(new Headers()),
        } as unknown as MaybeAuthenticatedTsRestRequestContext,
      }
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.ACTIVITY_NOT_FOUND,
    });
  });

  it('returns 404 when account is not owned by user', async () => {
    const foreignAccount = new Account({
      id: 'acc-999',
      accountNumber: baseAccount.accountNumber,
      name: 'Checking',
      ownerUserId: 'other-user',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      ledgerBalanceMinor: new Money(10_000),
      availableBalanceMinor: new Money(10_000),
      balanceVersion: 1,
    });

    vi.mocked(repositoryMock.getAccountById).mockResolvedValue(foreignAccount);

    const response = await getActivityDetailHandler(
      {
        params: {
          accountNumber: baseAccount.accountNumber,
          activityId: 'TXN#txn-123',
        },
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

  it('throws when authentication is missing', async () => {
    await expect(
      getActivityDetailHandler(
        {
          params: {
            accountNumber: baseAccount.accountNumber,
            activityId: 'TXN#txn-123',
          },
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
});
