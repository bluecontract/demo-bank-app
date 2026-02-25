import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setCreditLimit } from './setCreditLimit';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import type { BankingRepository } from '../ports';
import { AccountNotFoundError, ForbiddenError } from '../errors';
import { InvalidAccountError } from '../../domain/errors';

const buildCreditLineAccount = (overrides: Partial<Account> = {}) => {
  return new Account({
    id: 'acc-123',
    accountNumber: '1234567890',
    name: 'Merchant Credit Line',
    ownerUserId: 'user-123',
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date('2024-01-01'),
    accountType: 'CREDIT_LINE',
    creditLimitMinor: new Money(1000),
    ledgerBalanceMinor: new Money(800),
    availableBalanceMinor: new Money(700),
    balanceVersion: 0,
    ...overrides,
  });
};

describe('setCreditLimit', () => {
  let repository: BankingRepository;

  beforeEach(() => {
    repository = {
      saveAccount: vi.fn(),
      updateAccountBalance: vi.fn(),
      getAccountById: vi.fn(),
      getAccountIdByNumber: vi.fn(),
      getAccountsByUserId: vi.fn(),
      saveTransactionWithAccounts: vi.fn(),
      getTransactionsByAccount: vi.fn(),
      getTransactionById: vi.fn(),
    };
  });

  it('updates credit limit and balances', async () => {
    const account = buildCreditLineAccount();
    vi.mocked(repository.getAccountById).mockResolvedValue(account);
    vi.mocked(repository.updateAccountBalance).mockResolvedValue(account);

    const result = await setCreditLimit(
      {
        accountId: account.id,
        userId: 'user-123',
        creditLimitMinor: 1500,
      },
      { repository }
    );

    expect(result.creditLimitMinor?.toCents()).toBe(1500);
    expect(result.ledgerBalanceMinor.toCents()).toBe(1300);
    expect(result.availableBalanceMinor.toCents()).toBe(1200);
    expect(repository.updateAccountBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        creditLimitMinor: expect.any(Money),
      })
    );
  });

  it('throws when account not found', async () => {
    vi.mocked(repository.getAccountById).mockResolvedValue(null);

    await expect(
      setCreditLimit(
        { accountId: 'missing', userId: 'user-123', creditLimitMinor: 1000 },
        { repository }
      )
    ).rejects.toThrow(new AccountNotFoundError('missing'));
  });

  it('throws when account is not owned by user', async () => {
    const account = buildCreditLineAccount({ ownerUserId: 'other-user' });
    vi.mocked(repository.getAccountById).mockResolvedValue(account);

    await expect(
      setCreditLimit(
        { accountId: account.id, userId: 'user-123', creditLimitMinor: 1000 },
        { repository }
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws when account type is not credit line', async () => {
    const account = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Deposit',
      ownerUserId: 'user-123',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      accountType: 'DEPOSIT',
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 0,
    });
    vi.mocked(repository.getAccountById).mockResolvedValue(account);

    await expect(
      setCreditLimit(
        { accountId: account.id, userId: 'user-123', creditLimitMinor: 1000 },
        { repository }
      )
    ).rejects.toThrow(InvalidAccountError);
  });

  it('throws when new limit is below used credit', async () => {
    const account = buildCreditLineAccount();
    vi.mocked(repository.getAccountById).mockResolvedValue(account);

    await expect(
      setCreditLimit(
        { accountId: account.id, userId: 'user-123', creditLimitMinor: 200 },
        { repository }
      )
    ).rejects.toThrow(InvalidAccountError);
  });

  it('allows lowering limit when balance is above current limit', async () => {
    const account = buildCreditLineAccount({
      creditLimitMinor: new Money(1000),
      ledgerBalanceMinor: new Money(1300),
      availableBalanceMinor: new Money(1200),
    });
    vi.mocked(repository.getAccountById).mockResolvedValue(account);
    vi.mocked(repository.updateAccountBalance).mockResolvedValue(account);

    const result = await setCreditLimit(
      {
        accountId: account.id,
        userId: 'user-123',
        creditLimitMinor: 900,
      },
      { repository }
    );

    expect(result.creditLimitMinor?.toCents()).toBe(900);
    expect(result.ledgerBalanceMinor.toCents()).toBe(1200);
    expect(result.availableBalanceMinor.toCents()).toBe(1100);
  });
});
