import { describe, it, expect, vi } from 'vitest';
import { getAccount } from './getAccount';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { AccountNotFoundError } from '../errors';

// Mock repository implementation
const createMockRepository = () => ({
  saveAccount: vi.fn(),
  saveTransactionWithAccounts: vi.fn(),
  getAccountById: vi.fn(),
  getAccountIdByNumber: vi.fn(),
  getAccountsByUserId: vi.fn(),
  getTransactionsByAccount: vi.fn(),
  getTransactionById: vi.fn(),
});

describe('getAccount', () => {
  it('should return account when account exists and user is authorized', async () => {
    const mockRepository = createMockRepository();
    const account = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Account',
      ownerUserId: 'user-456',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date(),
      ledgerBalanceMinor: new Money(10000),
      availableBalanceMinor: new Money(9500),
      balanceVersion: 1,
    });

    mockRepository.getAccountById.mockResolvedValue(account);

    const result = await getAccount(
      { accountId: 'acc-123', userId: 'user-456' },
      { repository: mockRepository }
    );

    expect(result).toBe(account);
    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
  });

  it('should throw AccountNotFoundError when account does not exist', async () => {
    const mockRepository = createMockRepository();
    mockRepository.getAccountById.mockResolvedValue(null);

    await expect(
      getAccount(
        { accountId: 'acc-123', userId: 'user-456' },
        { repository: mockRepository }
      )
    ).rejects.toThrow(AccountNotFoundError);

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
  });

  it('should throw AccountNotFoundError when user is not the account owner', async () => {
    const mockRepository = createMockRepository();
    const account = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Account',
      ownerUserId: 'user-456',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date(),
      ledgerBalanceMinor: new Money(10000),
      availableBalanceMinor: new Money(9500),
      balanceVersion: 1,
    });

    mockRepository.getAccountById.mockResolvedValue(account);

    await expect(
      getAccount(
        { accountId: 'acc-123', userId: 'user-789' },
        { repository: mockRepository }
      )
    ).rejects.toThrow(AccountNotFoundError);

    expect(mockRepository.getAccountById).toHaveBeenCalledWith('acc-123');
  });

  it('should handle different account statuses', async () => {
    const mockRepository = createMockRepository();
    const account = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Account',
      ownerUserId: 'user-456',
      status: 'SUSPENDED',
      currency: 'USD',
      createdAt: new Date(),
      ledgerBalanceMinor: new Money(10000),
      availableBalanceMinor: new Money(9500),
      balanceVersion: 1,
    });

    mockRepository.getAccountById.mockResolvedValue(account);

    const result = await getAccount(
      { accountId: 'acc-123', userId: 'user-456' },
      { repository: mockRepository }
    );

    expect(result).toBe(account);
    expect(result.status).toBe('SUSPENDED');
  });

  it('should propagate repository errors', async () => {
    const mockRepository = createMockRepository();
    const error = new Error('Database connection failed');
    mockRepository.getAccountById.mockRejectedValue(error);

    await expect(
      getAccount(
        { accountId: 'acc-123', userId: 'user-456' },
        { repository: mockRepository }
      )
    ).rejects.toThrow('Database connection failed');
  });

  it('should handle different user IDs correctly', async () => {
    const mockRepository = createMockRepository();
    const account = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Test Account',
      ownerUserId: 'different-user',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date(),
      ledgerBalanceMinor: new Money(10000),
      availableBalanceMinor: new Money(9500),
      balanceVersion: 1,
    });

    mockRepository.getAccountById.mockResolvedValue(account);

    const result = await getAccount(
      { accountId: 'acc-123', userId: 'different-user' },
      { repository: mockRepository }
    );

    expect(result).toBe(account);
    expect(result.ownerUserId).toBe('different-user');
  });
});
