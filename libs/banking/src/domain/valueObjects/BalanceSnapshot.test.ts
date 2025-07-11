import { describe, it, expect } from 'vitest';
import { BalanceSnapshot } from './BalanceSnapshot';
import { Money } from './Money';

describe('BalanceSnapshot', () => {
  describe('constructor', () => {
    it('should create a valid balance snapshot', () => {
      const balance = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      expect(balance.accountId).toBe('acc-123');
      expect(balance.ledgerBalance.toCents()).toBe(1000);
      expect(balance.availableBalance.toCents()).toBe(900);
      expect(balance.version).toBe(1);
    });

    it('should allow equal ledger and available balances', () => {
      const balance = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(1000),
        version: 1,
      });

      expect(balance.ledgerBalance.equals(balance.availableBalance)).toBe(true);
    });

    it('should allow zero balances', () => {
      const balance = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: Money.ZERO,
        availableBalance: Money.ZERO,
        version: 1,
      });

      expect(balance.ledgerBalance.isZero()).toBe(true);
      expect(balance.availableBalance.isZero()).toBe(true);
    });

    it('should throw error for empty account ID', () => {
      expect(
        () =>
          new BalanceSnapshot({
            accountId: '',
            ledgerBalance: new Money(1000),
            availableBalance: new Money(900),
            version: 1,
          })
      ).toThrow('Account ID cannot be empty');
    });

    it('should throw error for negative version', () => {
      expect(
        () =>
          new BalanceSnapshot({
            accountId: 'acc-123',
            ledgerBalance: new Money(1000),
            availableBalance: new Money(900),
            version: -1,
          })
      ).toThrow('Version must be non-negative');
    });

    it('should throw error when available balance exceeds ledger balance', () => {
      expect(
        () =>
          new BalanceSnapshot({
            accountId: 'acc-123',
            ledgerBalance: new Money(900),
            availableBalance: new Money(1000),
            version: 1,
          })
      ).toThrow('Available balance cannot exceed ledger balance');
    });

    it('should allow zero version', () => {
      const balance = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 0,
      });

      expect(balance.version).toBe(0);
    });
  });

  describe('addToBalance', () => {
    it('should add amount to both ledger and available balances', () => {
      const balance = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      const newBalance = balance.addToBalance(new Money(100));

      expect(newBalance.ledgerBalance.toCents()).toBe(1100);
      expect(newBalance.availableBalance.toCents()).toBe(1000);
      expect(newBalance.version).toBe(2);
      expect(newBalance.accountId).toBe('acc-123');
    });

    it('should not mutate original balance', () => {
      const balance = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      balance.addToBalance(new Money(100));

      expect(balance.ledgerBalance.toCents()).toBe(1000);
      expect(balance.availableBalance.toCents()).toBe(900);
      expect(balance.version).toBe(1);
    });
  });

  describe('subtractFromBalance', () => {
    it('should subtract amount from both ledger and available balances', () => {
      const balance = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      const newBalance = balance.subtractFromBalance(new Money(100));

      expect(newBalance.ledgerBalance.toCents()).toBe(900);
      expect(newBalance.availableBalance.toCents()).toBe(800);
      expect(newBalance.version).toBe(2);
      expect(newBalance.accountId).toBe('acc-123');
    });

    it('should throw error when subtraction would result in negative balance', () => {
      const balance = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      expect(() => balance.subtractFromBalance(new Money(1001))).toThrow();
    });

    it('should not mutate original balance', () => {
      const balance = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      balance.subtractFromBalance(new Money(100));

      expect(balance.ledgerBalance.toCents()).toBe(1000);
      expect(balance.availableBalance.toCents()).toBe(900);
      expect(balance.version).toBe(1);
    });
  });

  describe('equals', () => {
    it('should be equal for same properties', () => {
      const balance1 = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      const balance2 = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      expect(balance1.equals(balance2)).toBe(true);
    });

    it('should not be equal for different account IDs', () => {
      const balance1 = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      const balance2 = new BalanceSnapshot({
        accountId: 'acc-456',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      expect(balance1.equals(balance2)).toBe(false);
    });

    it('should not be equal for different versions', () => {
      const balance1 = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      const balance2 = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 2,
      });

      expect(balance1.equals(balance2)).toBe(false);
    });

    it('should not be equal for different balances', () => {
      const balance1 = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(1000),
        availableBalance: new Money(900),
        version: 1,
      });

      const balance2 = new BalanceSnapshot({
        accountId: 'acc-123',
        ledgerBalance: new Money(2000),
        availableBalance: new Money(900),
        version: 1,
      });

      expect(balance1.equals(balance2)).toBe(false);
    });
  });
});
