import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTransaction } from './getTransaction';
import { Account } from '../../domain/entities/Account';
import { Transaction } from '../../domain/entities/Transaction';
import { Posting } from '../../domain/valueObjects/Posting';
import { Money } from '../../domain/valueObjects/Money';
import { BankingRepository } from '../ports';
import { AccountNotFoundError, TransactionNotFoundError } from '../errors';
import { TransactionResult } from '../dtos';

// Helper function to create test accounts with required properties
const createTestAccount = (
  overrides: Partial<ConstructorParameters<typeof Account>[0]> = {}
) => {
  return new Account({
    id: 'acc-123',
    accountNumber: '1234567890',
    ownerUserId: 'user-456',
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date('2024-01-01'),
    name: 'Test Account',
    ledgerBalanceMinor: new Money(0),
    availableBalanceMinor: new Money(0),
    balanceVersion: 0,
    ...overrides,
  });
};

describe('getTransaction', () => {
  let mockRepository: BankingRepository;

  beforeEach(() => {
    mockRepository = {
      saveAccount: vi.fn(),
      getAccountById: vi.fn(),
      getAccountIdByNumber: vi.fn(),
      getAccountsByUserId: vi.fn(),
      saveTransactionWithAccounts: vi.fn(),
      getTransactionsByAccount: vi.fn(),
      getTransactionById: vi.fn(),
    };
  });

  it('should return transaction when account exists, user is authorized, and transaction involves account', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
      transactionId: 'txn-789',
    };

    const account = createTestAccount();

    const transaction = new Transaction({
      id: 'txn-789',
      type: 'FUNDING',
      status: 'POSTED',
      postings: [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(1000),
          side: 'CREDIT',
          accountNumber: '1234567890',
          counterpartyAccountNumber: 'FUNDING_SOURCE',
        }),
        new Posting({
          accountId: 'FUNDING_SOURCE',
          amount: new Money(1000),
          side: 'DEBIT',
          accountNumber: '0000000000',
          counterpartyAccountNumber: '1234567890',
        }),
      ],
      description: 'Test transaction',
      createdAt: new Date('2024-01-01'),
    });

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(mockRepository.getTransactionById).mockResolvedValue(transaction);

    // When
    const result = await getTransaction(query, {
      repository: mockRepository,
    });

    // Then
    const expectedResult: TransactionResult = {
      id: 'txn-789',
      type: 'FUNDING',
      status: 'POSTED',
      postings: [
        {
          accountId: 'acc-123',
          amount: new Money(1000),
          side: 'CREDIT',
          accountNumber: '1234567890',
          counterpartyAccountNumber: 'FUNDING_SOURCE',
        },
        {
          accountId: 'FUNDING_SOURCE',
          amount: new Money(1000),
          side: 'DEBIT',
          accountNumber: '0000000000',
          counterpartyAccountNumber: '1234567890',
        },
      ],
      description: 'Test transaction',
      transactionIdempotencyKey: undefined,
      createdAt: new Date('2024-01-01'),
    };

    expect(result).toEqual(expectedResult);
    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
    expect(mockRepository.getTransactionById).toHaveBeenCalledWith('txn-789');
  });

  it('should throw AccountNotFoundError when account does not exist', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'nonexistent',
      transactionId: 'txn-789',
    };

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(null);

    // When & Then
    await expect(
      getTransaction(query, {
        repository: mockRepository,
      })
    ).rejects.toThrow(new AccountNotFoundError('nonexistent'));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('nonexistent');
    expect(mockRepository.getTransactionById).not.toHaveBeenCalled();
  });

  it('should throw AccountNotFoundError when user is not the account owner', async () => {
    // Given
    const query = {
      userId: 'unauthorized-user',
      accountId: 'acc-123',
      transactionId: 'txn-789',
    };

    const account = createTestAccount({
      ownerUserId: 'user-456', // Different user
    });

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);

    // When & Then
    await expect(
      getTransaction(query, {
        repository: mockRepository,
      })
    ).rejects.toThrow(new AccountNotFoundError('acc-123'));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
    expect(mockRepository.getTransactionById).not.toHaveBeenCalled();
  });

  it('should throw TransactionNotFoundError when transaction does not exist', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
      transactionId: 'nonexistent',
    };

    const account = createTestAccount();

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(mockRepository.getTransactionById).mockResolvedValue(null);

    // When & Then
    await expect(
      getTransaction(query, {
        repository: mockRepository,
      })
    ).rejects.toThrow(new TransactionNotFoundError('nonexistent'));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
    expect(mockRepository.getTransactionById).toHaveBeenCalledWith(
      'nonexistent'
    );
  });

  it('should throw TransactionNotFoundError when transaction does not involve the account', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
      transactionId: 'txn-789',
    };

    const account = createTestAccount();

    const transaction = new Transaction({
      id: 'txn-789',
      type: 'FUNDING',
      status: 'POSTED',
      postings: [
        new Posting({
          accountId: 'acc-456', // Different account
          amount: new Money(1000),
          side: 'CREDIT',
          accountNumber: '9876543210',
          counterpartyAccountNumber: 'FUNDING_SOURCE',
        }),
        new Posting({
          accountId: 'FUNDING_SOURCE',
          amount: new Money(1000),
          side: 'DEBIT',
          accountNumber: '0000000000',
          counterpartyAccountNumber: '9876543210',
        }),
      ],
      description: 'Test transaction',
      createdAt: new Date('2024-01-01'),
    });

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(mockRepository.getTransactionById).mockResolvedValue(transaction);

    // When & Then
    await expect(
      getTransaction(query, {
        repository: mockRepository,
      })
    ).rejects.toThrow(new TransactionNotFoundError('txn-789'));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
    expect(mockRepository.getTransactionById).toHaveBeenCalledWith('txn-789');
  });

  it('should handle repository errors gracefully', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
      transactionId: 'txn-789',
    };

    const repositoryError = new Error('Database connection failed');
    vi.mocked(mockRepository.getAccountById).mockRejectedValue(repositoryError);

    // When & Then
    await expect(
      getTransaction(query, {
        repository: mockRepository,
      })
    ).rejects.toThrow(repositoryError);

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
    expect(mockRepository.getTransactionById).not.toHaveBeenCalled();
  });

  it('should return DTO instead of domain object', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
      transactionId: 'txn-789',
    };

    const account = createTestAccount();

    const transaction = new Transaction({
      id: 'txn-789',
      type: 'FUNDING',
      status: 'POSTED',
      postings: [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(500),
          side: 'CREDIT',
          accountNumber: '1234567890',
          counterpartyAccountNumber: 'FUNDING_SOURCE',
        }),
        new Posting({
          accountId: 'FUNDING_SOURCE',
          amount: new Money(500),
          side: 'DEBIT',
          accountNumber: '0000000000',
          counterpartyAccountNumber: '1234567890',
        }),
      ],
      description: 'Test transaction',
      createdAt: new Date('2024-01-01'),
    });

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(mockRepository.getTransactionById).mockResolvedValue(transaction);

    // When
    const result = await getTransaction(query, {
      repository: mockRepository,
    });

    // Then
    expect(result).not.toBeInstanceOf(Transaction);
    expect(result.postings[0]).not.toBeInstanceOf(Posting);
    expect(result.postings[0].amount).toBeInstanceOf(Money);
    expect(typeof result.id).toBe('string');
    expect(typeof result.type).toBe('string');
    expect(typeof result.status).toBe('string');
    expect(Array.isArray(result.postings)).toBe(true);
  });
});
