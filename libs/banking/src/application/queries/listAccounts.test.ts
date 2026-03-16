import { describe, it, expect, vi } from 'vitest';
import { listAccounts } from './listAccounts';
import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { AccountResult } from '../dtos';

// Mock repository implementation
const createMockRepository = () => ({
  saveAccount: vi.fn(),
  updateAccountBalance: vi.fn(),
  saveTransactionWithAccounts: vi.fn(),
  getAccountById: vi.fn(),
  getAccountIdByNumber: vi.fn(),
  getAccountsByUserId: vi.fn(),
  getTransactionsByAccount: vi.fn(),
  getTransactionById: vi.fn(),
});

describe('listAccounts', () => {
  it('should return user accounts when user has accounts', async () => {
    const mockRepository = createMockRepository();
    const createdAt1 = new Date();
    const createdAt2 = new Date();
    const accounts = [
      new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'Savings Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: createdAt1,
        ledgerBalanceMinor: new Money(50000),
        availableBalanceMinor: new Money(45000),
        balanceVersion: 1,
      }),
      new Account({
        id: 'acc-456',
        accountNumber: '0987654321',
        name: 'Checking Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: createdAt2,
        ledgerBalanceMinor: new Money(10000),
        availableBalanceMinor: new Money(9500),
        balanceVersion: 1,
      }),
    ];

    mockRepository.getAccountsByUserId.mockResolvedValue(accounts);

    const result = await listAccounts(
      { userId: 'user-456' },
      { repository: mockRepository }
    );

    const expectedResult: AccountResult[] = [
      {
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'Savings Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: createdAt1,
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: new Money(50000),
        availableBalanceMinor: new Money(45000),
        balanceVersion: 1,
      },
      {
        id: 'acc-456',
        accountNumber: '0987654321',
        name: 'Checking Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: createdAt2,
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: new Money(10000),
        availableBalanceMinor: new Money(9500),
        balanceVersion: 1,
      },
    ];

    expect(result).toEqual(expectedResult);
    expect(mockRepository.getAccountsByUserId).toHaveBeenCalledWith('user-456');
  });

  it('should return empty array when user has no accounts', async () => {
    const mockRepository = createMockRepository();
    mockRepository.getAccountsByUserId.mockResolvedValue([]);

    const result = await listAccounts(
      { userId: 'user-789' },
      { repository: mockRepository }
    );

    expect(result).toEqual([]);
    expect(mockRepository.getAccountsByUserId).toHaveBeenCalledWith('user-789');
  });

  it('should return single account when user has one account', async () => {
    const mockRepository = createMockRepository();
    const createdAt = new Date();
    const account = new Account({
      id: 'acc-123',
      accountNumber: '1234567890',
      name: 'Savings Account',
      ownerUserId: 'user-456',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt,
      ledgerBalanceMinor: new Money(50000),
      availableBalanceMinor: new Money(45000),
      balanceVersion: 1,
    });

    mockRepository.getAccountsByUserId.mockResolvedValue([account]);

    const result = await listAccounts(
      { userId: 'user-456' },
      { repository: mockRepository }
    );

    const expectedResult: AccountResult[] = [
      {
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'Savings Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: new Money(50000),
        availableBalanceMinor: new Money(45000),
        balanceVersion: 1,
      },
    ];

    expect(result).toEqual(expectedResult);
    expect(result).toHaveLength(1);
    expect(mockRepository.getAccountsByUserId).toHaveBeenCalledWith('user-456');
  });

  it('should handle accounts with different statuses', async () => {
    const mockRepository = createMockRepository();
    const createdAt1 = new Date();
    const createdAt2 = new Date();
    const accounts = [
      new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'Active Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: createdAt1,
        ledgerBalanceMinor: new Money(50000),
        availableBalanceMinor: new Money(45000),
        balanceVersion: 1,
      }),
      new Account({
        id: 'acc-456',
        accountNumber: '0987654321',
        name: 'Suspended Account',
        ownerUserId: 'user-456',
        status: 'SUSPENDED',
        currency: 'USD',
        createdAt: createdAt2,
        ledgerBalanceMinor: new Money(10000),
        availableBalanceMinor: new Money(9500),
        balanceVersion: 1,
      }),
    ];

    mockRepository.getAccountsByUserId.mockResolvedValue(accounts);

    const result = await listAccounts(
      { userId: 'user-456' },
      { repository: mockRepository }
    );

    const expectedResult: AccountResult[] = [
      {
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'Active Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: createdAt1,
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: new Money(50000),
        availableBalanceMinor: new Money(45000),
        balanceVersion: 1,
      },
      {
        id: 'acc-456',
        accountNumber: '0987654321',
        name: 'Suspended Account',
        ownerUserId: 'user-456',
        status: 'SUSPENDED',
        currency: 'USD',
        createdAt: createdAt2,
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: new Money(10000),
        availableBalanceMinor: new Money(9500),
        balanceVersion: 1,
      },
    ];

    expect(result).toEqual(expectedResult);
    expect(result[0].status).toBe('ACTIVE');
    expect(result[1].status).toBe('SUSPENDED');
  });

  it('should propagate repository errors', async () => {
    const mockRepository = createMockRepository();
    const error = new Error('Database connection failed');
    mockRepository.getAccountsByUserId.mockRejectedValue(error);

    await expect(
      listAccounts({ userId: 'user-456' }, { repository: mockRepository })
    ).rejects.toThrow('Database connection failed');
  });

  it('should handle different user IDs correctly', async () => {
    const mockRepository = createMockRepository();
    const createdAt = new Date();
    const accounts = [
      new Account({
        id: 'acc-999',
        accountNumber: '5555555555',
        name: 'Different User Account',
        ownerUserId: 'different-user',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
        ledgerBalanceMinor: new Money(75000),
        availableBalanceMinor: new Money(70000),
        balanceVersion: 1,
      }),
    ];

    mockRepository.getAccountsByUserId.mockResolvedValue(accounts);

    const result = await listAccounts(
      { userId: 'different-user' },
      { repository: mockRepository }
    );

    const expectedResult: AccountResult[] = [
      {
        id: 'acc-999',
        accountNumber: '5555555555',
        name: 'Different User Account',
        ownerUserId: 'different-user',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
        accountType: 'DEPOSIT',
        creditLimitMinor: undefined,
        ledgerBalanceMinor: new Money(75000),
        availableBalanceMinor: new Money(70000),
        balanceVersion: 1,
      },
    ];

    expect(result).toEqual(expectedResult);
    expect(result[0].ownerUserId).toBe('different-user');
    expect(mockRepository.getAccountsByUserId).toHaveBeenCalledWith(
      'different-user'
    );
  });
});
