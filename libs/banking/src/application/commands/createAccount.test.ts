import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAccount } from './createAccount.ts';
import { BankingRepository, AccountNumberGenerator } from '../ports';
import { Money } from '../../domain/valueObjects/Money';

describe('createAccount', () => {
  let mockRepository: BankingRepository;
  let mockAccountNumberGenerator: AccountNumberGenerator;

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

    mockAccountNumberGenerator = {
      generate: vi.fn(),
    };
  });

  it('should create a new account successfully', async () => {
    // Given
    const command = {
      ownerId: 'user-123',
      name: 'My Savings Account',
    };

    const generatedAccountNumber = '1234567890';
    vi.mocked(mockAccountNumberGenerator.generate).mockReturnValue(
      generatedAccountNumber
    );

    // Mock the implementation to return the account that was passed to it
    vi.mocked(mockRepository.saveAccount).mockImplementation(
      async account => account
    );

    // When
    const result = await createAccount(command, {
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
    });

    // Then
    expect(result.accountNumber).toBe(generatedAccountNumber);
    expect(result.name).toBe(command.name);
    expect(result.ownerUserId).toBe(command.ownerId);
    expect(result.status).toBe('ACTIVE');
    expect(result.currency).toBe('USD');
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.ledgerBalanceMinor).toBeInstanceOf(Money);
    expect(result.availableBalanceMinor).toBeInstanceOf(Money);
    expect(result.balanceVersion).toBe(0);
    expect(mockAccountNumberGenerator.generate).toHaveBeenCalledTimes(1);
    expect(mockRepository.saveAccount).toHaveBeenCalledTimes(1);
    expect(mockRepository.saveAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: generatedAccountNumber,
        name: command.name,
        ownerUserId: command.ownerId,
        status: 'ACTIVE',
        currency: 'USD',
      })
    );
  });

  it('should create account with name', async () => {
    // Given
    const command = {
      ownerId: 'user-123',
      name: 'Business Checking Account',
    };

    vi.mocked(mockAccountNumberGenerator.generate).mockReturnValue(
      '1234567890'
    );
    vi.mocked(mockRepository.saveAccount).mockImplementation(
      async account => account
    );

    // When
    const result = await createAccount(command, {
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
    });

    // Then
    expect(result.name).toBe('Business Checking Account');
  });

  it('should generate unique account ID', async () => {
    // Given
    const command = {
      ownerId: 'user-123',
      name: 'My Account',
    };

    vi.mocked(mockAccountNumberGenerator.generate).mockReturnValue(
      '1234567890'
    );
    vi.mocked(mockRepository.saveAccount).mockImplementation(
      async account => account
    );

    // When
    const result1 = await createAccount(command, {
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
    });

    const result2 = await createAccount(command, {
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
    });

    // Then
    expect(result1.id).not.toBe(result2.id);
  });

  it('should set account status to ACTIVE by default', async () => {
    // Given
    const command = {
      ownerId: 'user-123',
      name: 'My Account',
    };

    vi.mocked(mockAccountNumberGenerator.generate).mockReturnValue(
      '1234567890'
    );
    vi.mocked(mockRepository.saveAccount).mockImplementation(
      async account => account
    );

    // When
    const result = await createAccount(command, {
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
    });

    // Then
    expect(result.status).toBe('ACTIVE');
  });

  it('should set creation timestamp as ISO string', async () => {
    // Given
    const command = {
      ownerId: 'user-123',
      name: 'My Account',
    };

    const beforeCreation = new Date();
    vi.mocked(mockAccountNumberGenerator.generate).mockReturnValue(
      '1234567890'
    );
    vi.mocked(mockRepository.saveAccount).mockImplementation(
      async account => account
    );

    // When
    const result = await createAccount(command, {
      repository: mockRepository,
      accountNumberGenerator: mockAccountNumberGenerator,
    });

    // Then
    const afterCreation = new Date();
    const createdAtDate = new Date(result.createdAt);
    expect(createdAtDate.getTime()).toBeGreaterThanOrEqual(
      beforeCreation.getTime()
    );
    expect(createdAtDate.getTime()).toBeLessThanOrEqual(
      afterCreation.getTime()
    );
  });

  it('should propagate repository errors', async () => {
    // Given
    const command = {
      ownerId: 'user-123',
      name: 'My Account',
    };

    vi.mocked(mockAccountNumberGenerator.generate).mockReturnValue(
      '1234567890'
    );
    vi.mocked(mockRepository.saveAccount).mockRejectedValue(
      new Error('Database error')
    );

    // When & Then
    await expect(
      createAccount(command, {
        repository: mockRepository,
        accountNumberGenerator: mockAccountNumberGenerator,
      })
    ).rejects.toThrow('Database error');
  });
});
