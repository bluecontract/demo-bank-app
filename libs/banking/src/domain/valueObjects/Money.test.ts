import { describe, it, expect } from 'vitest';
import { Money } from './Money';
import { InvalidMoneyAmountError } from '../errors';

describe('Money', () => {
  describe('constructor', () => {
    it('should create Money with valid amount in cents', () => {
      const money = new Money(100);
      expect(money.toCents()).toBe(100);
    });

    it('should throw error for negative amount', () => {
      expect(() => new Money(-1)).toThrow(InvalidMoneyAmountError);
    });

    it('should throw error for non-integer amount', () => {
      expect(() => new Money(100.5)).toThrow(InvalidMoneyAmountError);
    });

    it('should allow zero amount', () => {
      const money = new Money(0);
      expect(money.toCents()).toBe(0);
    });
  });

  describe('format', () => {
    it('should format money as currency string', () => {
      const money = new Money(123);
      expect(money.format()).toBe('$1.23');
    });

    it('should format whole dollars', () => {
      const money = new Money(500);
      expect(money.format()).toBe('$5.00');
    });

    it('should format zero', () => {
      const money = new Money(0);
      expect(money.format()).toBe('$0.00');
    });

    it('should format large amounts', () => {
      const money = new Money(123456);
      expect(money.format()).toBe('$1234.56');
    });
  });

  describe('arithmetic operations', () => {
    it('should add two Money objects', () => {
      const money1 = new Money(100);
      const money2 = new Money(50);
      const result = money1.add(money2);
      expect(result.toCents()).toBe(150);
    });

    it('should subtract two Money objects', () => {
      const money1 = new Money(100);
      const money2 = new Money(30);
      const result = money1.subtract(money2);
      expect(result.toCents()).toBe(70);
    });

    it('should handle subtraction resulting in zero', () => {
      const money1 = new Money(100);
      const money2 = new Money(100);
      const result = money1.subtract(money2);
      expect(result.toCents()).toBe(0);
    });

    it('should not mutate original objects', () => {
      const money1 = new Money(100);
      const money2 = new Money(50);
      money1.add(money2);
      expect(money1.toCents()).toBe(100);
      expect(money2.toCents()).toBe(50);
    });
  });

  describe('comparison operations', () => {
    it('should compare greater than', () => {
      const money1 = new Money(100);
      const money2 = new Money(50);
      expect(money1.isGreaterThan(money2)).toBe(true);
      expect(money2.isGreaterThan(money1)).toBe(false);
    });

    it('should compare less than', () => {
      const money1 = new Money(100);
      const money2 = new Money(50);
      expect(money1.isLessThan(money2)).toBe(false);
      expect(money2.isLessThan(money1)).toBe(true);
    });

    it('should check equality', () => {
      const money1 = new Money(100);
      const money2 = new Money(100);
      const money3 = new Money(50);
      expect(money1.equals(money2)).toBe(true);
      expect(money1.equals(money3)).toBe(false);
    });

    it('should check if positive', () => {
      const positive = new Money(100);
      const zero = new Money(0);
      expect(positive.isPositive()).toBe(true);
      expect(zero.isPositive()).toBe(false);
    });

    it('should check if zero', () => {
      const zero = new Money(0);
      const positive = new Money(100);
      expect(zero.isZero()).toBe(true);
      expect(positive.isZero()).toBe(false);
    });
  });

  describe('ZERO constant', () => {
    it('should provide a zero constant', () => {
      expect(Money.ZERO.toCents()).toBe(0);
      expect(Money.ZERO.isZero()).toBe(true);
    });
  });
});
