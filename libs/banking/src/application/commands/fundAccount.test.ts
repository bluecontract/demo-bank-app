import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fundAccount } from './fundAccount';
import { BankingRepository } from '../ports';
import { FUNDING_SOURCE } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { AccountNotFoundError } from '../errors';

// Mock transferMoney at the top level
vi.mock('./transferMoney', () => ({
  transferMoney: vi.fn(),
}));

describe('fundAccount', () => {
  let mockRepository: BankingRepository;
  let transferMoneySpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const transferMoneyModule = await import('./transferMoney');
    transferMoneySpy =
      transferMoneyModule.transferMoney as unknown as ReturnType<typeof vi.fn>;

    mockRepository = {
      saveAccount: vi.fn(),
      getAccountById: vi.fn(),
      getAccountIdByNumber: vi.fn(),
      getAccountsByUserId: vi.fn(),
      saveTransactionWithAccounts: vi.fn(),
      getTransactionsByAccount: vi.fn(),
      getTransactionById: vi.fn(),
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call transferMoney with correct arguments', async () => {
    transferMoneySpy.mockResolvedValue('txn-123');
    const mockAccount = {
      accountNumber: '1234567890',
      id: 'acc-123',
    };
    (mockRepository.getAccountById as any).mockResolvedValue(mockAccount);

    const command = {
      accountId: 'acc-123',
      amountMinor: new Money(1000),
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'fund-key-123',
      },
    };

    await fundAccount(command, { repository: mockRepository });

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
    expect(transferMoneySpy).toHaveBeenCalledWith(
      {
        srcAccountId: FUNDING_SOURCE.ACCOUNT_ID,
        dstAccountNumber: mockAccount.accountNumber,
        amountMinor: new Money(1000),
        description: 'Funding for account 1234567890',
        ctx: command.ctx,
      },
      { repository: mockRepository }
    );
  });

  it('should propagate errors from transferMoney', async () => {
    const mockAccount = {
      accountNumber: '1234567890',
      id: 'acc-123',
    };
    (mockRepository.getAccountById as any).mockResolvedValue(mockAccount);
    transferMoneySpy.mockRejectedValue(new Error('fail'));
    const command = {
      accountId: 'acc-123',
      amountMinor: new Money(1000),
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'fund-key-123',
      },
    };

    await expect(
      fundAccount(command, { repository: mockRepository })
    ).rejects.toThrow('fail');
  });

  it('should return the transaction ID from transferMoney', async () => {
    const mockAccount = {
      accountNumber: '1234567890',
      id: 'acc-123',
    };
    (mockRepository.getAccountById as any).mockResolvedValue(mockAccount);
    transferMoneySpy.mockResolvedValue('txn-456');
    const command = {
      accountId: 'acc-123',
      amountMinor: new Money(1000),
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'fund-key-123',
      },
    };

    const result = await fundAccount(command, { repository: mockRepository });
    expect(result).toBe('txn-456');
  });

  it('should throw AccountNotFoundError when account does not exist', async () => {
    (mockRepository.getAccountById as any).mockResolvedValue(null);
    const command = {
      accountId: 'nonexistent-account',
      amountMinor: new Money(1000),
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'fund-key-123',
      },
    };

    await expect(
      fundAccount(command, { repository: mockRepository })
    ).rejects.toThrow(new AccountNotFoundError('nonexistent-account'));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      'nonexistent-account'
    );
    expect(transferMoneySpy).not.toHaveBeenCalled();
  });

  it('should handle zero amount funding', async () => {
    transferMoneySpy.mockResolvedValue('txn-zero');
    const mockAccount = {
      accountNumber: '1234567890',
      id: 'acc-123',
    };
    (mockRepository.getAccountById as any).mockResolvedValue(mockAccount);

    const command = {
      accountId: 'acc-123',
      amountMinor: new Money(0),
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'fund-key-zero',
      },
    };

    const result = await fundAccount(command, { repository: mockRepository });

    expect(result).toBe('txn-zero');
    expect(transferMoneySpy).toHaveBeenCalledWith(
      {
        srcAccountId: FUNDING_SOURCE.ACCOUNT_ID,
        dstAccountNumber: mockAccount.accountNumber,
        amountMinor: new Money(0),
        description: 'Funding for account 1234567890',
        ctx: command.ctx,
      },
      { repository: mockRepository }
    );
  });

  it('should handle large amount funding', async () => {
    transferMoneySpy.mockResolvedValue('txn-large');
    const mockAccount = {
      accountNumber: '1234567890',
      id: 'acc-123',
    };
    (mockRepository.getAccountById as any).mockResolvedValue(mockAccount);

    const command = {
      accountId: 'acc-123',
      amountMinor: new Money(1000000), // $10,000
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'fund-key-large',
      },
    };

    const result = await fundAccount(command, { repository: mockRepository });

    expect(result).toBe('txn-large');
    expect(transferMoneySpy).toHaveBeenCalledWith(
      {
        srcAccountId: FUNDING_SOURCE.ACCOUNT_ID,
        dstAccountNumber: mockAccount.accountNumber,
        amountMinor: new Money(1000000),
        description: 'Funding for account 1234567890',
        ctx: command.ctx,
      },
      { repository: mockRepository }
    );
  });

  it('should propagate repository errors when fetching account', async () => {
    (mockRepository.getAccountById as any).mockRejectedValue(
      new Error('Database connection failed')
    );

    const command = {
      accountId: 'acc-123',
      amountMinor: new Money(1000),
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'fund-key-123',
      },
    };

    await expect(
      fundAccount(command, { repository: mockRepository })
    ).rejects.toThrow('Database connection failed');

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
    expect(transferMoneySpy).not.toHaveBeenCalled();
  });
});
