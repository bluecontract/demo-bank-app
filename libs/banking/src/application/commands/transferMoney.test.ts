import { describe, it, expect, beforeEach, vi } from 'vitest';
import { transferMoney } from './transferMoney';
import { Account } from '../../domain/entities/Account';
import { BankingRepository } from '../ports';
import { AccountNotFoundError, ForbiddenError } from '../errors';
import { InsufficientFundsError } from '../../domain/errors';
import { Money } from '../../domain/valueObjects/Money';

describe('transferMoney', () => {
  let mockRepository: BankingRepository;

  beforeEach(() => {
    mockRepository = {
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

  it('should transfer money successfully when all conditions are met', async () => {
    // Given
    const command = {
      srcAccountId: 'acc-123',
      dstAccountNumber: '9876543210',
      amountMinor: new Money(500),
      description: 'Payment for services',
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'transfer-key-123',
      },
    };

    const sourceAccount = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Source Account',
      ownerUserId: 'user-456',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(1000),
      availableBalanceMinor: new Money(1000),
      balanceVersion: 1,
    });

    const destinationAccount = new Account({
      id: 'acc-789',
      accountNumber: '9876543210',
      name: 'Test Destination Account',
      ownerUserId: 'user-999',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 0,
    });

    vi.mocked(mockRepository.getAccountIdByNumber).mockResolvedValue(
      destinationAccount.id
    );
    vi.mocked(mockRepository.getAccountById)
      .mockResolvedValueOnce(sourceAccount)
      .mockResolvedValueOnce(destinationAccount);
    vi.mocked(mockRepository.saveTransactionWithAccounts).mockResolvedValue(
      'txn-123'
    );

    // When
    await transferMoney(command, { repository: mockRepository });

    // Then
    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      sourceAccount.id
    );
    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      destinationAccount.id
    );
    expect(mockRepository.saveTransactionWithAccounts).toHaveBeenCalledTimes(1);
  });

  it('should throw AccountNotFoundError when source account does not exist', async () => {
    // Given
    const command = {
      srcAccountId: 'nonexistent',
      dstAccountNumber: '9876543210',
      amountMinor: new Money(500),
      description: 'Payment for services',
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'transfer-key-123',
      },
    };

    const destinationAccount = new Account({
      id: 'acc-789',
      accountNumber: '9876543210',
      name: 'Test Destination Account',
      ownerUserId: 'user-999',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 0,
    });

    vi.mocked(mockRepository.getAccountIdByNumber).mockResolvedValue(
      destinationAccount.id
    );
    vi.mocked(mockRepository.getAccountById).mockRejectedValue(
      new AccountNotFoundError(command.dstAccountNumber)
    );

    // When & Then
    await expect(
      transferMoney(command, { repository: mockRepository })
    ).rejects.toThrow(new AccountNotFoundError(command.dstAccountNumber));

    expect(mockRepository.getAccountIdByNumber).toHaveBeenCalledWith(
      command.dstAccountNumber
    );
  });

  it('should throw ForbiddenError when user is not the source account owner', async () => {
    // Given
    const command = {
      srcAccountId: 'acc-123',
      dstAccountNumber: '9876543210',
      amountMinor: new Money(500),
      description: 'Payment for services',
      ctx: {
        userId: 'unauthorized-user',
        idempotencyKey: 'transfer-key-123',
      },
    };

    const sourceAccount = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Source Account',
      ownerUserId: 'user-456', // Different user
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(1000),
      availableBalanceMinor: new Money(1000),
      balanceVersion: 1,
    });

    const destinationAccount = new Account({
      id: 'acc-789',
      accountNumber: '9876543210',
      ownerUserId: 'user-999',
      name: 'Test Destination Account',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 0,
    });

    vi.mocked(mockRepository.getAccountIdByNumber).mockResolvedValue(
      destinationAccount.id
    );
    vi.mocked(mockRepository.getAccountById)
      .mockResolvedValueOnce(sourceAccount)
      .mockResolvedValueOnce(destinationAccount);

    // When & Then
    await expect(
      transferMoney(command, { repository: mockRepository })
    ).rejects.toThrow(new ForbiddenError('Access denied to source account'));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      sourceAccount.id
    );
  });

  it('should throw AccountNotFoundError when destination account does not exist', async () => {
    // Given
    const command = {
      srcAccountId: 'acc-123',
      dstAccountNumber: '0123456789',
      amountMinor: new Money(500),
      description: 'Payment for services',
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'transfer-key-123',
      },
    };

    const sourceAccount = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Source Account',
      ownerUserId: 'user-456',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(1000),
      availableBalanceMinor: new Money(1000),
      balanceVersion: 1,
    });

    vi.mocked(mockRepository.getAccountIdByNumber).mockResolvedValue(
      '1234567890'
    );
    vi.mocked(mockRepository.getAccountById)
      .mockResolvedValueOnce(sourceAccount)
      .mockRejectedValueOnce(new AccountNotFoundError('nonexistent'));

    // When & Then
    await expect(
      transferMoney(command, { repository: mockRepository })
    ).rejects.toThrow(new AccountNotFoundError('nonexistent'));

    expect(mockRepository.getAccountIdByNumber).toHaveBeenCalledWith(
      command.dstAccountNumber
    );
  });

  it('should throw InsufficientFundsError when balance is insufficient', async () => {
    // Given
    const command = {
      srcAccountId: 'acc-123',
      dstAccountNumber: '9876543210',
      amountMinor: new Money(1500),
      description: 'Payment for services',
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'transfer-key-123',
      },
    };

    const sourceAccount = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Source Account',
      ownerUserId: 'user-456',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(1000),
      availableBalanceMinor: new Money(1000), // Less than requested amount
      balanceVersion: 1,
    });

    const destinationAccount = new Account({
      id: 'acc-789',
      accountNumber: '9876543210',
      name: 'Test Destination Account',
      ownerUserId: 'user-999',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 0,
    });

    vi.mocked(mockRepository.getAccountIdByNumber).mockResolvedValue(
      destinationAccount.id
    );
    vi.mocked(mockRepository.getAccountById)
      .mockResolvedValueOnce(sourceAccount)
      .mockResolvedValueOnce(destinationAccount);

    // When & Then
    await expect(
      transferMoney(command, { repository: mockRepository })
    ).rejects.toThrow(new InsufficientFundsError(1500, 1000));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      sourceAccount.id
    );
    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      destinationAccount.id
    );
  });

  it('should throw InsufficientFundsError when balance does not exist', async () => {
    // Given
    const command = {
      srcAccountId: 'acc-123',
      dstAccountNumber: '9876543210',
      amountMinor: new Money(100),
      description: 'Payment for services',
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'transfer-key-123',
      },
    };

    const sourceAccount = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Source Account',
      ownerUserId: 'user-456',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0), // No balance
      balanceVersion: 1,
    });

    const destinationAccount = new Account({
      id: 'acc-789',
      accountNumber: '9876543210',
      name: 'Test Destination Account',
      ownerUserId: 'user-999',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 0,
    });

    vi.mocked(mockRepository.getAccountIdByNumber).mockResolvedValue(
      destinationAccount.id
    );
    vi.mocked(mockRepository.getAccountById)
      .mockResolvedValueOnce(sourceAccount)
      .mockResolvedValueOnce(destinationAccount);

    // When & Then
    await expect(
      transferMoney(command, { repository: mockRepository })
    ).rejects.toThrow(new InsufficientFundsError(100, 0));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      sourceAccount.id
    );
    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      destinationAccount.id
    );
  });

  it('should handle exact balance amount transfer', async () => {
    // Given
    const command = {
      srcAccountId: 'acc-123',
      dstAccountNumber: '9876543210',
      amountMinor: new Money(1000),
      description: 'Payment for services',
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'transfer-key-123',
      },
    };

    const sourceAccount = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Source Account',
      ownerUserId: 'user-456',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(1000),
      availableBalanceMinor: new Money(1000),
      balanceVersion: 1,
    });

    const destinationAccount = new Account({
      id: 'acc-789',
      accountNumber: '9876543210',
      name: 'Test Destination Account',
      ownerUserId: 'user-999',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01'),
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 0,
    });

    vi.mocked(mockRepository.getAccountIdByNumber).mockResolvedValue(
      destinationAccount.id
    );
    vi.mocked(mockRepository.getAccountById)
      .mockResolvedValueOnce(sourceAccount)
      .mockResolvedValueOnce(destinationAccount);
    vi.mocked(mockRepository.saveTransactionWithAccounts).mockResolvedValue(
      'txn-123'
    );

    // When
    await transferMoney(command, { repository: mockRepository });

    // Then
    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      sourceAccount.id
    );
    expect(mockRepository.getAccountById).toHaveBeenCalledWith(
      destinationAccount.id
    );
    expect(mockRepository.saveTransactionWithAccounts).toHaveBeenCalledTimes(1);
  });

  it('should propagate repository errors', async () => {
    // Given
    const command = {
      srcAccountId: 'acc-123',
      dstAccountNumber: '9876543210',
      amountMinor: new Money(500),
      description: 'Payment for services',
      ctx: {
        userId: 'user-456',
        idempotencyKey: 'transfer-key-123',
      },
    };

    const repositoryError = new Error('Database connection failed');
    vi.mocked(mockRepository.getAccountIdByNumber).mockRejectedValue(
      repositoryError
    );

    // When & Then
    await expect(
      transferMoney(command, { repository: mockRepository })
    ).rejects.toThrow(repositoryError);

    expect(mockRepository.getAccountIdByNumber).toHaveBeenCalledWith(
      command.dstAccountNumber
    );
  });
});
