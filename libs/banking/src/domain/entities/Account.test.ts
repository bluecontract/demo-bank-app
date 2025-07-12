import { describe, it, expect } from 'vitest';
import { Account } from './Account';
import { AccountInactiveError } from '../errors';
import { Money } from '../valueObjects/Money';

// Helper function to create test accounts with default balance and version
const createTestAccount = (overrides = {}) => {
  return new Account({
    id: 'acc-123',
    accountNumber: '1234567890',
    name: 'My Savings Account',
    ownerUserId: 'user-456',
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date('2024-01-01'),
    ledgerBalanceMinor: new Money(0),
    availableBalanceMinor: new Money(0),
    balanceVersion: 0,
    ...overrides,
  });
};

describe('Account', () => {
  describe('constructor', () => {
    it('should create a valid account', () => {
      const account = createTestAccount();

      expect(account.id).toBe('acc-123');
      expect(account.accountNumber).toBe('1234567890');
      expect(account.name).toBe('My Savings Account');
      expect(account.ownerUserId).toBe('user-456');
      expect(account.status).toBe('ACTIVE');
      expect(account.currency).toBe('USD');
      expect(account.createdAt).toEqual(new Date('2024-01-01'));
    });

    it('should throw error for empty name', () => {
      expect(() => createTestAccount({ name: '' })).toThrow(
        'Account name cannot be empty'
      );
    });

    it('should throw error for whitespace-only name', () => {
      expect(() => createTestAccount({ name: '   ' })).toThrow(
        'Account name cannot be empty'
      );
    });

    it('should throw error for name longer than 100 characters', () => {
      const longName = 'a'.repeat(101);
      expect(() => createTestAccount({ name: longName })).toThrow(
        'Account name must be 100 characters or less'
      );
    });

    it('should create account with exactly 100 character name', () => {
      const maxName = 'a'.repeat(100);
      const account = createTestAccount({ name: maxName });

      expect(account.name).toBe(maxName);
    });

    it('should throw error for empty id', () => {
      expect(() => createTestAccount({ id: '' })).toThrow(
        'Account ID cannot be empty'
      );
    });

    it('should throw error for empty account number', () => {
      expect(() => createTestAccount({ accountNumber: '' })).toThrow(
        'Account number cannot be empty'
      );
    });

    it('should throw error for empty owner user ID', () => {
      expect(() => createTestAccount({ ownerUserId: '' })).toThrow(
        'Owner user ID cannot be empty'
      );
    });

    it('should throw error for invalid account number length', () => {
      expect(
        () => createTestAccount({ accountNumber: '123456789' }) // 9 digits
      ).toThrow('Account number must be exactly 10 digits');
    });

    it('should throw error for non-numeric account number', () => {
      expect(() => createTestAccount({ accountNumber: '123456789a' })).toThrow(
        'Account number must be exactly 10 digits'
      );
    });

    it('should create account with suspended status', () => {
      const account = createTestAccount({ status: 'SUSPENDED' });

      expect(account.status).toBe('SUSPENDED');
    });

    it('should create account with closed status', () => {
      const account = createTestAccount({ status: 'CLOSED' });

      expect(account.status).toBe('CLOSED');
    });

    it('should throw error when ledger balance is not provided', () => {
      expect(() => {
        new Account({
          id: 'acc-123',
          accountNumber: '1234567890',
          name: 'My Account',
          ownerUserId: 'user-456',
          status: 'ACTIVE',
          currency: 'USD',
          createdAt: new Date(),
          availableBalanceMinor: new Money(0),
          balanceVersion: 0,
        } as any);
      }).toThrow('Ledger balance must be provided');
    });

    it('should throw error when available balance is not provided', () => {
      expect(() => {
        new Account({
          id: 'acc-123',
          accountNumber: '1234567890',
          name: 'My Account',
          ownerUserId: 'user-456',
          status: 'ACTIVE',
          currency: 'USD',
          createdAt: new Date(),
          ledgerBalanceMinor: new Money(0),
          balanceVersion: 0,
        } as any);
      }).toThrow('Available balance must be provided');
    });

    it('should throw error when balance version is not provided', () => {
      expect(() => {
        new Account({
          id: 'acc-123',
          accountNumber: '1234567890',
          name: 'My Account',
          ownerUserId: 'user-456',
          status: 'ACTIVE',
          currency: 'USD',
          createdAt: new Date(),
          ledgerBalanceMinor: new Money(0),
          availableBalanceMinor: new Money(0),
        } as any);
      }).toThrow('Balance version must be a non-negative number');
    });

    it('should throw error when balance version is negative', () => {
      expect(() => {
        createTestAccount({ balanceVersion: -1 });
      }).toThrow('Balance version must be a non-negative number');
    });
  });

  describe('isActive', () => {
    it('should return true for active account', () => {
      const account = createTestAccount({ status: 'ACTIVE' });

      expect(account.isActive()).toBe(true);
    });

    it('should return false for suspended account', () => {
      const account = createTestAccount({ status: 'SUSPENDED' });

      expect(account.isActive()).toBe(false);
    });

    it('should return false for closed account', () => {
      const account = createTestAccount({ status: 'CLOSED' });

      expect(account.isActive()).toBe(false);
    });
  });

  describe('ensureActive', () => {
    it('should not throw for active account', () => {
      const account = createTestAccount({ status: 'ACTIVE' });

      expect(() => account.ensureActive()).not.toThrow();
    });

    it('should throw for suspended account', () => {
      const account = createTestAccount({ status: 'SUSPENDED' });

      expect(() => account.ensureActive()).toThrow(AccountInactiveError);
    });

    it('should throw for closed account', () => {
      const account = createTestAccount({ status: 'CLOSED' });

      expect(() => account.ensureActive()).toThrow(AccountInactiveError);
    });
  });

  describe('isOwnedBy', () => {
    it('should return true for correct owner', () => {
      const account = createTestAccount({ ownerUserId: 'user-123' });

      expect(account.isOwnedBy('user-123')).toBe(true);
    });

    it('should return false for different owner', () => {
      const account = createTestAccount({ ownerUserId: 'user-123' });

      expect(account.isOwnedBy('user-456')).toBe(false);
    });
  });

  describe('equals', () => {
    it('should be equal for same properties', () => {
      const props = {
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'Test Account',
        ownerUserId: 'user-123',
        status: 'ACTIVE' as const,
        currency: 'USD' as const,
        createdAt: new Date('2024-01-01'),
        ledgerBalanceMinor: new Money(1000),
        availableBalanceMinor: new Money(900),
        balanceVersion: 1,
      };
      const account1 = new Account(props);
      const account2 = new Account(props);

      expect(account1.equals(account2)).toBe(true);
    });

    it('should not be equal for different IDs', () => {
      const baseProps = {
        accountNumber: '1234567890',
        name: 'Test Account',
        ownerUserId: 'user-123',
        status: 'ACTIVE' as const,
        currency: 'USD' as const,
        createdAt: new Date('2024-01-01'),
        ledgerBalanceMinor: new Money(1000),
        availableBalanceMinor: new Money(900),
        balanceVersion: 1,
      };
      const account1 = new Account({ ...baseProps, id: 'acc-123' });
      const account2 = new Account({ ...baseProps, id: 'acc-456' });

      expect(account1.equals(account2)).toBe(false);
    });

    it('should not be equal for different account numbers', () => {
      const baseProps = {
        id: 'acc-123',
        name: 'Test Account',
        ownerUserId: 'user-123',
        status: 'ACTIVE' as const,
        currency: 'USD' as const,
        createdAt: new Date('2024-01-01'),
        ledgerBalanceMinor: new Money(1000),
        availableBalanceMinor: new Money(900),
        balanceVersion: 1,
      };
      const account1 = new Account({
        ...baseProps,
        accountNumber: '1234567890',
      });
      const account2 = new Account({
        ...baseProps,
        accountNumber: '0987654321',
      });

      expect(account1.equals(account2)).toBe(false);
    });

    it('should not be equal for different names', () => {
      const baseProps = {
        id: 'acc-123',
        accountNumber: '1234567890',
        ownerUserId: 'user-123',
        status: 'ACTIVE' as const,
        currency: 'USD' as const,
        createdAt: new Date('2024-01-01'),
        ledgerBalanceMinor: new Money(1000),
        availableBalanceMinor: new Money(900),
        balanceVersion: 1,
      };
      const account1 = new Account({ ...baseProps, name: 'Test Account 1' });
      const account2 = new Account({ ...baseProps, name: 'Test Account 2' });

      expect(account1.equals(account2)).toBe(false);
    });

    it('should not be equal for different statuses', () => {
      const baseProps = {
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'Test Account',
        ownerUserId: 'user-123',
        currency: 'USD' as const,
        createdAt: new Date('2024-01-01'),
        ledgerBalanceMinor: new Money(1000),
        availableBalanceMinor: new Money(900),
        balanceVersion: 1,
      };
      const account1 = new Account({ ...baseProps, status: 'ACTIVE' });
      const account2 = new Account({ ...baseProps, status: 'CLOSED' });

      expect(account1.equals(account2)).toBe(false);
    });
  });
});
