import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listTransactions } from './listTransactions';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { BankingRepository, TransactionSummary } from '../ports';
import { PaginatedResult } from '../../domain/types';
import { AccountNotFoundError } from '../errors';

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

describe('listTransactions', () => {
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

  it('should return transactions when account exists and user is authorized', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
      pagination: { limit: 10 },
    };

    const account = createTestAccount();

    const transactions: TransactionSummary[] = [
      {
        transactionId: 'txn-123',
        type: 'FUNDING',
        status: 'POSTED',
        amount: new Money(10000),
        side: 'DEBIT',
        description: 'Initial deposit',
        createdAt: new Date('2024-01-01'),
      },
      {
        transactionId: 'txn-456',
        type: 'TRANSFER',
        status: 'POSTED',
        amount: new Money(2000),
        side: 'CREDIT',
        description: 'Transfer to account 9876543210',
        createdAt: new Date('2024-01-02'),
      },
    ];

    const paginatedResult: PaginatedResult<TransactionSummary> = {
      items: transactions,
      nextToken: undefined,
      hasMore: false,
    };

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(mockRepository.getTransactionsByAccount).mockResolvedValue(
      paginatedResult
    );

    // When
    const result = await listTransactions(query, {
      repository: mockRepository,
    });

    // Then
    expect(result).toBe(paginatedResult);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].transactionId).toBe('txn-123');
    expect(result.items[1].transactionId).toBe('txn-456');
    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
    expect(mockRepository.getTransactionsByAccount).toHaveBeenCalledWith(
      'acc-123',
      { limit: 10 }
    );
  });

  it('should throw AccountNotFoundError when account does not exist', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'nonexistent',
    };

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(null);

    // When & Then
    await expect(
      listTransactions(query, {
        repository: mockRepository,
      })
    ).rejects.toThrow(new AccountNotFoundError('nonexistent'));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('nonexistent');
    expect(mockRepository.getTransactionsByAccount).not.toHaveBeenCalled();
  });

  it('should throw AccountNotFoundError when user is not the account owner', async () => {
    // Given
    const query = {
      userId: 'unauthorized-user',
      accountId: 'acc-123',
    };

    const account = createTestAccount({
      ownerUserId: 'user-456', // Different user
    });

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);

    // When & Then
    await expect(
      listTransactions(query, {
        repository: mockRepository,
      })
    ).rejects.toThrow(new AccountNotFoundError('acc-123'));

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
    expect(mockRepository.getTransactionsByAccount).not.toHaveBeenCalled();
  });

  it('should return empty transactions when account has no transactions', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
    };

    const account = createTestAccount();

    const paginatedResult: PaginatedResult<TransactionSummary> = {
      items: [],
      nextToken: undefined,
      hasMore: false,
    };

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(mockRepository.getTransactionsByAccount).mockResolvedValue(
      paginatedResult
    );

    // When
    const result = await listTransactions(query, {
      repository: mockRepository,
    });

    // Then
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextToken).toBeUndefined();
  });

  it('should handle pagination correctly', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
      pagination: {
        limit: 5,
        nextToken: 'some-token',
      },
    };

    const account = createTestAccount();

    const transactions: TransactionSummary[] = [
      {
        transactionId: 'txn-123',
        type: 'FUNDING',
        status: 'POSTED',
        amount: new Money(10000),
        side: 'DEBIT',
        description: 'Initial deposit',
        createdAt: new Date('2024-01-01'),
      },
    ];

    const paginatedResult: PaginatedResult<TransactionSummary> = {
      items: transactions,
      nextToken: 'next-token',
      hasMore: true,
    };

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(mockRepository.getTransactionsByAccount).mockResolvedValue(
      paginatedResult
    );

    // When
    const result = await listTransactions(query, {
      repository: mockRepository,
    });

    // Then
    expect(result.hasMore).toBe(true);
    expect(result.nextToken).toBe('next-token');
    expect(mockRepository.getTransactionsByAccount).toHaveBeenCalledWith(
      'acc-123',
      {
        limit: 5,
        nextToken: 'some-token',
      }
    );
  });

  it('should work without pagination options', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
    };

    const account = createTestAccount();

    const paginatedResult: PaginatedResult<TransactionSummary> = {
      items: [],
      nextToken: undefined,
      hasMore: false,
    };

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(mockRepository.getTransactionsByAccount).mockResolvedValue(
      paginatedResult
    );

    // When
    const result = await listTransactions(query, {
      repository: mockRepository,
    });

    // Then
    expect(result).toBe(paginatedResult);
    expect(mockRepository.getTransactionsByAccount).toHaveBeenCalledWith(
      'acc-123',
      undefined
    );
  });

  it('should rethrow repository errors', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
    };

    vi.mocked(mockRepository.getAccountById).mockRejectedValue(
      new Error('Database error')
    );

    // When & Then
    await expect(
      listTransactions(query, {
        repository: mockRepository,
      })
    ).rejects.toThrow('Database error');
  });

  it('should rethrow transaction retrieval errors', async () => {
    // Given
    const query = {
      userId: 'user-456',
      accountId: 'acc-123',
    };

    const account = createTestAccount();

    vi.mocked(mockRepository.getAccountById).mockResolvedValue(account);
    vi.mocked(mockRepository.getTransactionsByAccount).mockRejectedValue(
      new Error('Transaction service error')
    );

    // When & Then
    await expect(
      listTransactions(query, {
        repository: mockRepository,
      })
    ).rejects.toThrow('Transaction service error');
  });
});
