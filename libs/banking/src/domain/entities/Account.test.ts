import { describe, it, expect } from 'vitest';
import { Account } from './Account';
import { AccountInactiveError } from '../errors';

describe('Account', () => {
  describe('constructor', () => {
    it('should create a valid account', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Savings Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date('2024-01-01'),
      });

      expect(account.id).toBe('acc-123');
      expect(account.accountNumber).toBe('1234567890');
      expect(account.name).toBe('My Savings Account');
      expect(account.ownerUserId).toBe('user-456');
      expect(account.status).toBe('ACTIVE');
      expect(account.currency).toBe('USD');
      expect(account.createdAt).toEqual(new Date('2024-01-01'));
    });

    it('should throw error for empty name', () => {
      expect(
        () =>
          new Account({
            id: 'acc-123',
            accountNumber: '1234567890',
            name: '',
            ownerUserId: 'user-456',
            status: 'ACTIVE',
            currency: 'USD',
            createdAt: new Date(),
          })
      ).toThrow('Account name cannot be empty');
    });

    it('should throw error for whitespace-only name', () => {
      expect(
        () =>
          new Account({
            id: 'acc-123',
            accountNumber: '1234567890',
            name: '   ',
            ownerUserId: 'user-456',
            status: 'ACTIVE',
            currency: 'USD',
            createdAt: new Date(),
          })
      ).toThrow('Account name cannot be empty');
    });

    it('should throw error for name longer than 100 characters', () => {
      const longName = 'a'.repeat(101);
      expect(
        () =>
          new Account({
            id: 'acc-123',
            accountNumber: '1234567890',
            name: longName,
            ownerUserId: 'user-456',
            status: 'ACTIVE',
            currency: 'USD',
            createdAt: new Date(),
          })
      ).toThrow('Account name must be 100 characters or less');
    });

    it('should create account with exactly 100 character name', () => {
      const maxName = 'a'.repeat(100);
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: maxName,
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(account.name).toBe(maxName);
    });

    it('should throw error for empty id', () => {
      expect(
        () =>
          new Account({
            id: '',
            accountNumber: '1234567890',
            name: 'My Account',
            ownerUserId: 'user-456',
            status: 'ACTIVE',
            currency: 'USD',
            createdAt: new Date(),
          })
      ).toThrow('Account ID cannot be empty');
    });

    it('should throw error for empty account number', () => {
      expect(
        () =>
          new Account({
            id: 'acc-123',
            accountNumber: '',
            name: 'My Account',
            ownerUserId: 'user-456',
            status: 'ACTIVE',
            currency: 'USD',
            createdAt: new Date(),
          })
      ).toThrow('Account number cannot be empty');
    });

    it('should throw error for empty owner user ID', () => {
      expect(
        () =>
          new Account({
            id: 'acc-123',
            accountNumber: '1234567890',
            name: 'My Account',
            ownerUserId: '',
            status: 'ACTIVE',
            currency: 'USD',
            createdAt: new Date(),
          })
      ).toThrow('Owner user ID cannot be empty');
    });

    it('should throw error for invalid account number length', () => {
      expect(
        () =>
          new Account({
            id: 'acc-123',
            accountNumber: '123456789', // 9 digits
            name: 'My Account',
            ownerUserId: 'user-456',
            status: 'ACTIVE',
            currency: 'USD',
            createdAt: new Date(),
          })
      ).toThrow('Account number must be exactly 10 digits');
    });

    it('should throw error for non-numeric account number', () => {
      expect(
        () =>
          new Account({
            id: 'acc-123',
            accountNumber: '123456789a',
            name: 'My Account',
            ownerUserId: 'user-456',
            status: 'ACTIVE',
            currency: 'USD',
            createdAt: new Date(),
          })
      ).toThrow('Account number must be exactly 10 digits');
    });

    it('should create account with suspended status', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'SUSPENDED',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(account.status).toBe('SUSPENDED');
    });

    it('should create account with closed status', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'CLOSED',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(account.status).toBe('CLOSED');
    });
  });

  describe('isActive', () => {
    it('should return true for active account', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(account.isActive()).toBe(true);
    });

    it('should return false for suspended account', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'SUSPENDED',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(account.isActive()).toBe(false);
    });

    it('should return false for closed account', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'CLOSED',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(account.isActive()).toBe(false);
    });
  });

  describe('ensureActive', () => {
    it('should not throw for active account', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(() => account.ensureActive()).not.toThrow();
    });

    it('should throw for suspended account', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'SUSPENDED',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(() => account.ensureActive()).toThrow(AccountInactiveError);
    });

    it('should throw for closed account', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'CLOSED',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(() => account.ensureActive()).toThrow(AccountInactiveError);
    });
  });

  describe('isOwnedBy', () => {
    it('should return true for correct owner', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(account.isOwnedBy('user-456')).toBe(true);
    });

    it('should return false for different owner', () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
      });

      expect(account.isOwnedBy('user-789')).toBe(false);
    });
  });

  describe('equals', () => {
    it('should be equal for same properties', () => {
      const createdAt = new Date('2024-01-01');
      const account1 = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
      });

      const account2 = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
      });

      expect(account1.equals(account2)).toBe(true);
    });

    it('should not be equal for different IDs', () => {
      const createdAt = new Date('2024-01-01');
      const account1 = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
      });

      const account2 = new Account({
        id: 'acc-456',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
      });

      expect(account1.equals(account2)).toBe(false);
    });

    it('should not be equal for different account numbers', () => {
      const createdAt = new Date('2024-01-01');
      const account1 = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
      });

      const account2 = new Account({
        id: 'acc-123',
        accountNumber: '0987654321',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
      });

      expect(account1.equals(account2)).toBe(false);
    });

    it('should not be equal for different names', () => {
      const createdAt = new Date('2024-01-01');
      const account1 = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
      });

      const account2 = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'Different Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
      });

      expect(account1.equals(account2)).toBe(false);
    });

    it('should not be equal for different statuses', () => {
      const createdAt = new Date('2024-01-01');
      const account1 = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt,
      });

      const account2 = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'SUSPENDED',
        currency: 'USD',
        createdAt,
      });

      expect(account1.equals(account2)).toBe(false);
    });
  });
});
