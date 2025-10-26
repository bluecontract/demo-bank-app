import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reserveFunds } from './reserveFunds';
import type { ReserveHoldRequest } from '../HoldRepository';
import type { BankingRepository } from '../ports';
import type { HoldRepository } from '../HoldRepository';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { hashIdempotencyKey } from '../../domain/idempotency';
import { AccountNotFoundError, ForbiddenError } from '../errors';
import {
  InvalidAccountError,
  InvalidMoneyAmountError,
  InsufficientFundsError,
} from '../../domain/errors';
import type { Hold } from '../../domain/entities/Hold';

const BASE_ACCOUNT_PROPS = {
  id: 'acc-123',
  accountNumber: '1234567890',
  name: 'Checking',
  ownerUserId: 'user-1',
  status: 'ACTIVE' as const,
  currency: 'USD' as const,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  ledgerBalanceMinor: new Money(10_000),
  availableBalanceMinor: new Money(10_000),
  balanceVersion: 1,
};

const createAccount = (
  overrides: Partial<ConstructorParameters<typeof Account>[0]> = {}
) => new Account({ ...BASE_ACCOUNT_PROPS, ...overrides });

const createDependencies = () => {
  const bankingRepository: Partial<BankingRepository> = {
    getAccountIdByNumber: vi.fn(),
    getAccountById: vi.fn(),
  };

  const holdRepository: Partial<HoldRepository> = {
    reserveHold: vi.fn(),
  };

  return {
    bankingRepository: bankingRepository as BankingRepository,
    holdRepository: holdRepository as HoldRepository,
    bankingRepositoryMock: bankingRepository,
    holdRepositoryMock: holdRepository,
  };
};

describe('reserveFunds', () => {
  const command = {
    userId: 'user-1',
    idempotencyKey: 'idem-123',
    payerAccountNumber: '1234567890',
    amountMinor: 5_000,
    description: 'Test hold',
    counterpartyAccountNumber: '5555555555',
    payNoteEventId: 'event-created',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('reserves funds successfully with generated hold id', async () => {
    const { bankingRepositoryMock, holdRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount();
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);
    vi.mocked(holdRepositoryMock.reserveHold!).mockImplementation(
      async (request: ReserveHoldRequest) => ({
        hold: request.hold,
        created: true,
      })
    );

    const hold = await reserveFunds(command, {
      ...deps,
      idGenerator: () => 'hold-123',
    });

    expect(hold.holdId).toBe('hold-123');
    expect(hold.status).toBe('PENDING');
    expect(hold.createdAt).toBe('2024-01-02T00:00:00.000Z');
    expect(hold.amountMinor).toBe(command.amountMinor);
    expect(hold.payNoteEventId).toBe(command.payNoteEventId);

    expect(holdRepositoryMock.reserveHold).toHaveBeenCalledTimes(1);
    const request = vi.mocked(holdRepositoryMock.reserveHold!).mock.calls[0][0];
    expect(request.accountId).toBe(account.id);
    expect(request.accountBalanceVersion).toBe(account.balanceVersion);
    expect(request.holdEvent.createdByUserId).toBe(command.userId);
    expect(request.holdEvent.idempotencyKeyHash).toBe(
      hashIdempotencyKey(command.idempotencyKey)
    );
    expect(request.holdEvent.payNoteEventId).toBe(command.payNoteEventId);
  });

  it('uses provided hold id when supplied', async () => {
    const { bankingRepositoryMock, holdRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount();
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);
    vi.mocked(holdRepositoryMock.reserveHold!).mockImplementation(
      async (request: ReserveHoldRequest) => ({
        hold: request.hold,
        created: true,
      })
    );

    const holdIdCommand = { ...command, holdId: 'hold-provided' };
    const hold = await reserveFunds(holdIdCommand, deps);

    expect(hold.holdId).toBe('hold-provided');
  });

  it('throws AccountNotFoundError when account number is unknown', async () => {
    const { bankingRepositoryMock, ...deps } = createDependencies();
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      null
    );

    await expect(reserveFunds(command, deps)).rejects.toBeInstanceOf(
      AccountNotFoundError
    );
  });

  it('throws AccountNotFoundError when account id lookup fails', async () => {
    const { bankingRepositoryMock, ...deps } = createDependencies();
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      'acc-unknown'
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(null);

    await expect(reserveFunds(command, deps)).rejects.toBeInstanceOf(
      AccountNotFoundError
    );
  });

  it('throws ForbiddenError when account is not owned by user', async () => {
    const { bankingRepositoryMock, ...deps } = createDependencies();
    const account = createAccount({ ownerUserId: 'user-2' });
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);

    await expect(reserveFunds(command, deps)).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it('throws InvalidAccountError when currency is unsupported', async () => {
    const { bankingRepositoryMock, ...deps } = createDependencies();
    const account = createAccount();
    (account as any).currency = 'EUR';
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);

    await expect(reserveFunds(command, deps)).rejects.toBeInstanceOf(
      InvalidAccountError
    );
  });

  it('throws InvalidMoneyAmountError for non-positive amounts', async () => {
    const { bankingRepositoryMock, ...deps } = createDependencies();
    const account = createAccount();
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);

    await expect(
      reserveFunds({ ...command, amountMinor: 0 }, deps)
    ).rejects.toBeInstanceOf(InvalidMoneyAmountError);
  });

  it('throws InsufficientFundsError when balance is too low', async () => {
    const { bankingRepositoryMock, holdRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount({
      availableBalanceMinor: new Money(100),
    });
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);

    await expect(reserveFunds(command, deps)).rejects.toBeInstanceOf(
      InsufficientFundsError
    );
    expect(holdRepositoryMock.reserveHold).not.toHaveBeenCalled();
  });

  it('returns existing hold when repository reports idempotent retry', async () => {
    const { bankingRepositoryMock, holdRepositoryMock, ...deps } =
      createDependencies();
    const account = createAccount();
    vi.mocked(bankingRepositoryMock.getAccountIdByNumber!).mockResolvedValue(
      account.id
    );
    vi.mocked(bankingRepositoryMock.getAccountById!).mockResolvedValue(account);
    const existingHold: Hold = {
      holdId: 'hold-existing',
      payerAccountNumber: account.accountNumber,
      amountMinor: command.amountMinor,
      currency: 'USD',
      status: 'PENDING',
      createdAt: '2024-01-02T00:00:00.000Z',
    };
    vi.mocked(holdRepositoryMock.reserveHold!).mockResolvedValue({
      hold: existingHold,
      created: false,
    });

    const hold = await reserveFunds(command, deps);

    expect(hold).toEqual(existingHold);
  });
});
