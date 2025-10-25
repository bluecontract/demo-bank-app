import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listAccountActivity } from './listAccountActivity';
import type { BankingRepository, TransactionSummary } from '../ports';
import type { HoldRepository, HoldActivityRecord } from '../HoldRepository';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { AccountNotFoundError, InvalidActivityCursorError } from '../errors';

const buildAccount = () =>
  new Account({
    id: 'acc-123',
    accountNumber: '1234567890',
    name: 'Primary Account',
    ownerUserId: 'user-1',
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ledgerBalanceMinor: new Money(10_000),
    availableBalanceMinor: new Money(10_000),
    balanceVersion: 1,
    isTest: false,
  });

const buildTransactionSummary = (
  overrides: Partial<TransactionSummary> & {
    transactionId: string;
    createdAt: Date;
  }
): TransactionSummary => ({
  transactionId: overrides.transactionId,
  type: 'TRANSFER',
  status: 'POSTED',
  amount: new Money(1_000),
  side: 'DEBIT',
  description: overrides.description ?? 'Transfer',
  counterpartyAccountNumber: '9876543210',
  createdAt: overrides.createdAt,
  originHoldId: overrides.originHoldId,
});

const holdActivityRecord = (
  overrides: Partial<HoldActivityRecord> & {
    holdId: string;
    eventId: string;
    event: HoldActivityRecord['event'];
  }
): HoldActivityRecord => ({
  holdId: overrides.holdId,
  payerAccountNumber: overrides.payerAccountNumber ?? '1234567890',
  amountMinor: overrides.amountMinor ?? 5_000,
  currency: 'USD',
  description: overrides.description,
  counterpartyAccountNumber: overrides.counterpartyAccountNumber,
  eventId: overrides.eventId,
  event: overrides.event,
});

describe('listAccountActivity', () => {
  let bankingRepositoryMock: {
    getAccountById: ReturnType<typeof vi.fn>;
    getAccountIdByNumber: ReturnType<typeof vi.fn>;
    getTransactionsByAccount: ReturnType<typeof vi.fn>;
  };
  let holdRepositoryMock: {
    listHoldActivityByAccountNumber: ReturnType<typeof vi.fn>;
  };
  let bankingRepository: BankingRepository;
  let holdRepository: HoldRepository;

  beforeEach(() => {
    bankingRepositoryMock = {
      getAccountById: vi.fn().mockResolvedValue(buildAccount()),
      getAccountIdByNumber: vi.fn().mockResolvedValue('acc-123'),
      getTransactionsByAccount: vi.fn().mockResolvedValue({
        items: [] as TransactionSummary[],
        nextToken: undefined,
        hasMore: false,
      }),
    };

    holdRepositoryMock = {
      listHoldActivityByAccountNumber: vi.fn().mockResolvedValue({
        items: [] as HoldActivityRecord[],
        nextToken: undefined,
        hasMore: false,
      }),
    };

    bankingRepository = bankingRepositoryMock as unknown as BankingRepository;
    holdRepository = holdRepositoryMock as unknown as HoldRepository;
  });

  it('merges hold events and posted transactions in descending order', async () => {
    holdRepositoryMock.listHoldActivityByAccountNumber.mockResolvedValue({
      items: [
        holdActivityRecord({
          holdId: 'hold-2',
          eventId: 'event-2-captured',
          amountMinor: 4_000,
          description: 'Pending grocery',
          counterpartyAccountNumber: '5555555555',
          event: {
            at: '2024-01-03T08:00:00.000Z',
            type: 'CAPTURED',
            transactionId: 'txn-2',
            counterpartyAccountNumber: '5555555555',
          },
        }),
        holdActivityRecord({
          holdId: 'hold-2',
          eventId: 'event-2-created',
          amountMinor: 4_000,
          description: 'Pending grocery',
          counterpartyAccountNumber: '5555555555',
          event: {
            at: '2024-01-02T12:00:00.000Z',
            type: 'CREATED',
          },
        }),
        holdActivityRecord({
          holdId: 'hold-1',
          eventId: 'event-1-released',
          amountMinor: 3_500,
          description: 'Pending travel',
          event: {
            at: '2024-01-02T00:00:00.000Z',
            type: 'RELEASED',
            reason: 'Customer request',
          },
        }),
        holdActivityRecord({
          holdId: 'hold-1',
          eventId: 'event-1-created',
          amountMinor: 3_500,
          description: 'Pending travel',
          counterpartyAccountNumber: '6666666666',
          event: {
            at: '2024-01-01T12:00:00.000Z',
            type: 'CREATED',
          },
        }),
      ],
      nextToken: undefined,
      hasMore: false,
    });

    bankingRepositoryMock.getTransactionsByAccount.mockResolvedValue({
      items: [
        buildTransactionSummary({
          transactionId: 'txn-2',
          createdAt: new Date('2024-01-03T09:00:00.000Z'),
          description: 'Transfer in',
        }),
        buildTransactionSummary({
          transactionId: 'txn-1',
          createdAt: new Date('2024-01-02T06:00:00.000Z'),
          description: 'Transfer out',
          originHoldId: 'hold-2',
        }),
      ],
      nextToken: undefined,
      hasMore: false,
    });

    const result = await listAccountActivity(
      {
        userId: 'user-1',
        accountNumber: '1234567890',
      },
      {
        bankingRepository,
        holdRepository,
      }
    );

    expect(result.items.map(item => item.kind)).toEqual([
      'POSTED_TRANSACTION',
      'HOLD_CAPTURED',
      'HOLD_CREATED',
      'POSTED_TRANSACTION',
      'HOLD_RELEASED',
      'HOLD_CREATED',
    ]);

    expect(result.items[1]).toMatchObject({
      kind: 'HOLD_CAPTURED',
      holdId: 'hold-2',
      capturedAt: '2024-01-03T08:00:00.000Z',
      transactionId: 'txn-2',
    });
    expect(result.items[4]).toMatchObject({
      kind: 'HOLD_RELEASED',
      holdId: 'hold-1',
      releasedAt: '2024-01-02T00:00:00.000Z',
      releaseReason: 'Customer request',
    });
    expect(result.hasMore).toBe(false);

    const posted = result.items.find(
      item => item.kind === 'POSTED_TRANSACTION'
    );
    expect(posted).toMatchObject({
      side: 'DEBIT',
      type: 'TRANSFER',
      status: 'POSTED',
      counterpartyAccountNumber: '9876543210',
    });
  });

  it('supports pagination with cursor', async () => {
    const holdEvents: HoldActivityRecord[] = [
      holdActivityRecord({
        holdId: 'hold-3',
        eventId: 'event-3-created',
        amountMinor: 2_000,
        event: {
          at: '2024-01-04T12:00:00.000Z',
          type: 'CREATED',
        },
      }),
      holdActivityRecord({
        holdId: 'hold-2',
        eventId: 'event-2-created',
        amountMinor: 1_500,
        event: {
          at: '2024-01-03T12:00:00.000Z',
          type: 'CREATED',
        },
      }),
      holdActivityRecord({
        holdId: 'hold-1',
        eventId: 'event-1-created',
        amountMinor: 1_000,
        event: {
          at: '2024-01-02T12:00:00.000Z',
          type: 'CREATED',
        },
      }),
    ];

    holdRepositoryMock.listHoldActivityByAccountNumber
      .mockResolvedValueOnce({
        items: holdEvents.slice(0, 2),
        nextToken: 'hold-token-1',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: holdEvents.slice(2),
        nextToken: undefined,
        hasMore: false,
      });

    bankingRepositoryMock.getTransactionsByAccount
      .mockResolvedValueOnce({
        items: [
          buildTransactionSummary({
            transactionId: 'txn-2',
            createdAt: new Date('2024-01-04T11:00:00.000Z'),
          }),
        ],
        nextToken: 'txn-token-1',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [
          buildTransactionSummary({
            transactionId: 'txn-1',
            createdAt: new Date('2024-01-02T11:00:00.000Z'),
          }),
        ],
        nextToken: undefined,
        hasMore: false,
      });

    const firstPage = await listAccountActivity(
      {
        userId: 'user-1',
        accountNumber: '1234567890',
        limit: 2,
      },
      {
        bankingRepository,
        holdRepository,
      }
    );

    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items.map(item => item.kind)).toEqual([
      'HOLD_CREATED',
      'POSTED_TRANSACTION',
    ]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextToken).toBeDefined();

    const secondPage = await listAccountActivity(
      {
        userId: 'user-1',
        accountNumber: '1234567890',
        limit: 2,
        cursor: firstPage.nextToken,
      },
      {
        bankingRepository,
        holdRepository,
      }
    );

    expect(secondPage.items.map(item => item.kind)).toEqual([
      'HOLD_CREATED',
      'HOLD_CREATED',
    ]);
    expect(secondPage.hasMore).toBe(true);

    const thirdPage = await listAccountActivity(
      {
        userId: 'user-1',
        accountNumber: '1234567890',
        limit: 2,
        cursor: secondPage.nextToken,
      },
      {
        bankingRepository,
        holdRepository,
      }
    );

    expect(thirdPage.items).toHaveLength(1);
    expect(thirdPage.items[0]).toMatchObject({
      kind: 'POSTED_TRANSACTION',
      transactionId: 'txn-1',
    });
    expect(thirdPage.hasMore).toBe(false);
  });

  it('throws InvalidActivityCursorError when cursor cannot be decoded', async () => {
    await expect(
      listAccountActivity(
        {
          userId: 'user-1',
          accountNumber: '1234567890',
          cursor: '!!invalid!!',
        },
        {
          bankingRepository,
          holdRepository,
        }
      )
    ).rejects.toBeInstanceOf(InvalidActivityCursorError);
  });

  it('throws AccountNotFoundError when account lookup fails', async () => {
    bankingRepositoryMock.getAccountIdByNumber.mockResolvedValue(null);

    await expect(
      listAccountActivity(
        {
          userId: 'user-1',
          accountNumber: '0000000000',
        },
        {
          bankingRepository,
          holdRepository,
        }
      )
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});
