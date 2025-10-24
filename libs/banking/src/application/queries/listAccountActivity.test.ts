import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listAccountActivity } from './listAccountActivity';
import type { BankingRepository, TransactionSummary } from '../ports';
import type { HoldRepository } from '../HoldRepository';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import type { Hold } from '../../domain/entities/Hold';
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
  description: 'Transfer',
  counterpartyAccountNumber: '9876543210',
  createdAt: overrides.createdAt,
  originHoldId: overrides.originHoldId,
});

const buildPendingHold = (
  overrides: Partial<Hold> & { holdId: string }
): Hold => ({
  holdId: overrides.holdId,
  payerAccountNumber: overrides.payerAccountNumber ?? '1234567890',
  counterpartyAccountNumber: overrides.counterpartyAccountNumber,
  amountMinor: overrides.amountMinor ?? 5_000,
  currency: 'USD',
  status: 'PENDING',
  description: overrides.description,
  createdAt: overrides.createdAt ?? '2024-01-01T00:00:00.000Z',
});

describe('listAccountActivity', () => {
  let bankingRepositoryMock: {
    saveAccount: ReturnType<typeof vi.fn>;
    getAccountById: ReturnType<typeof vi.fn>;
    getAccountIdByNumber: ReturnType<typeof vi.fn>;
    getAccountsByUserId: ReturnType<typeof vi.fn>;
    saveTransactionWithAccounts: ReturnType<typeof vi.fn>;
    getTransactionsByAccount: ReturnType<typeof vi.fn>;
    getTransactionById: ReturnType<typeof vi.fn>;
  };
  let holdRepositoryMock: {
    putHoldMeta: ReturnType<typeof vi.fn>;
    appendHoldEvent: ReturnType<typeof vi.fn>;
    getHold: ReturnType<typeof vi.fn>;
    listPendingHoldsByAccountNumber: ReturnType<typeof vi.fn>;
    reserveHold: ReturnType<typeof vi.fn>;
    releaseHold: ReturnType<typeof vi.fn>;
    captureHold: ReturnType<typeof vi.fn>;
  };
  let bankingRepository: BankingRepository;
  let holdRepository: HoldRepository;

  beforeEach(() => {
    bankingRepositoryMock = {
      saveAccount: vi.fn(),
      getAccountById: vi.fn().mockResolvedValue(buildAccount()),
      getAccountIdByNumber: vi.fn().mockResolvedValue('acc-123'),
      getAccountsByUserId: vi.fn(),
      saveTransactionWithAccounts: vi.fn(),
      getTransactionsByAccount: vi.fn().mockResolvedValue({
        items: [] as TransactionSummary[],
        nextToken: undefined,
        hasMore: false,
      }),
      getTransactionById: vi.fn(),
    };
    holdRepositoryMock = {
      putHoldMeta: vi.fn(),
      appendHoldEvent: vi.fn(),
      getHold: vi.fn(),
      listPendingHoldsByAccountNumber: vi.fn().mockResolvedValue({
        items: [] as Hold[],
        nextToken: undefined,
        hasMore: false,
      }),
      reserveHold: vi.fn(),
      releaseHold: vi.fn(),
      captureHold: vi.fn(),
    };

    bankingRepository = bankingRepositoryMock as unknown as BankingRepository;
    holdRepository = holdRepositoryMock as unknown as HoldRepository;
  });

  it('merges pending holds and posted transactions in descending order', async () => {
    const holds: Hold[] = [
      buildPendingHold({
        holdId: 'hold-2',
        createdAt: '2024-01-02T12:00:00.000Z',
        amountMinor: 4_000,
        description: 'Pending grocery',
      }),
      buildPendingHold({
        holdId: 'hold-1',
        createdAt: '2024-01-01T12:00:00.000Z',
        amountMinor: 3_500,
        description: 'Pending travel',
      }),
    ];

    const transactions: TransactionSummary[] = [
      buildTransactionSummary({
        transactionId: 'txn-2',
        createdAt: new Date('2024-01-03T10:00:00.000Z'),
        description: 'Transfer in',
      }),
      buildTransactionSummary({
        transactionId: 'txn-1',
        createdAt: new Date('2024-01-02T08:00:00.000Z'),
        description: 'Transfer out',
        originHoldId: 'hold-2',
      }),
    ];

    holdRepositoryMock.listPendingHoldsByAccountNumber.mockResolvedValue({
      items: holds,
      nextToken: undefined,
      hasMore: false,
    });

    bankingRepositoryMock.getTransactionsByAccount.mockResolvedValue({
      items: transactions,
      nextToken: undefined,
      hasMore: false,
    });

    const result = await listAccountActivity(
      {
        userId: 'user-1',
        accountNumber: '1234567890',
        limit: 5,
      },
      {
        bankingRepository,
        holdRepository,
      }
    );

    expect(result.items.map(item => item.kind)).toEqual([
      'POSTED_TRANSACTION',
      'PENDING_HOLD',
      'POSTED_TRANSACTION',
      'PENDING_HOLD',
    ]);

    expect(result.items[0]).toMatchObject({
      kind: 'POSTED_TRANSACTION',
      transactionId: 'txn-2',
      postedAt: '2024-01-03T10:00:00.000Z',
      amountMinor: 1_000,
    });
    expect(result.items[1]).toMatchObject({
      kind: 'PENDING_HOLD',
      holdId: 'hold-2',
      createdAt: '2024-01-02T12:00:00.000Z',
      amountMinor: 4_000,
      description: 'Pending grocery',
    });
    expect(result.items[2]).toMatchObject({
      kind: 'POSTED_TRANSACTION',
      transactionId: 'txn-1',
      postedAt: '2024-01-02T08:00:00.000Z',
      amountMinor: 1_000,
      originHoldId: 'hold-2',
    });
    expect(result.items[3]).toMatchObject({
      kind: 'PENDING_HOLD',
      holdId: 'hold-1',
      createdAt: '2024-01-01T12:00:00.000Z',
      amountMinor: 3_500,
      description: 'Pending travel',
    });
    expect(result.nextToken).toBeUndefined();
    expect(result.hasMore).toBe(false);
  });

  it('paginates using cursor without duplicates or gaps', async () => {
    const holdPage: Hold[] = [
      buildPendingHold({
        holdId: 'hold-3',
        createdAt: '2024-01-03T09:00:00.000Z',
      }),
      buildPendingHold({
        holdId: 'hold-2',
        createdAt: '2024-01-02T09:00:00.000Z',
      }),
      buildPendingHold({
        holdId: 'hold-1',
        createdAt: '2024-01-01T09:00:00.000Z',
      }),
    ];

    const txnPage: TransactionSummary[] = [
      buildTransactionSummary({
        transactionId: 'txn-2',
        createdAt: new Date('2024-01-04T10:00:00.000Z'),
      }),
      buildTransactionSummary({
        transactionId: 'txn-1',
        createdAt: new Date('2024-01-02T06:00:00.000Z'),
      }),
    ];

    holdRepositoryMock.listPendingHoldsByAccountNumber.mockResolvedValue({
      items: holdPage,
      nextToken: undefined,
      hasMore: false,
    });

    bankingRepositoryMock.getTransactionsByAccount.mockResolvedValue({
      items: txnPage,
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

    expect(firstPage.items.map(item => item.kind)).toEqual([
      'POSTED_TRANSACTION',
      'PENDING_HOLD',
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
      'PENDING_HOLD',
      'POSTED_TRANSACTION',
    ]);
    expect(secondPage.items[0]).toMatchObject({
      kind: 'PENDING_HOLD',
      holdId: 'hold-2',
      createdAt: '2024-01-02T09:00:00.000Z',
    });
    expect(secondPage.items[1]).toMatchObject({
      kind: 'POSTED_TRANSACTION',
      transactionId: 'txn-1',
      postedAt: '2024-01-02T06:00:00.000Z',
      amountMinor: 1_000,
    });
    expect(secondPage.hasMore).toBe(true);
    expect(secondPage.nextToken).toBeDefined();

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

    expect(thirdPage.items).toEqual([
      {
        kind: 'PENDING_HOLD',
        holdId: 'hold-1',
        createdAt: '2024-01-01T09:00:00.000Z',
        amountMinor: 5_000,
        description: undefined,
      },
    ]);
    expect(thirdPage.hasMore).toBe(false);
    expect(thirdPage.nextToken).toBeUndefined();
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
