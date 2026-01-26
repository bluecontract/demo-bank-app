import { describe, it, expect } from 'vitest';
import { SimpleAccountNumberGenerator } from './SimpleAccountNumberGenerator';
import { CARD_SETTLEMENT, FUNDING_SOURCE } from '../domain/entities/Account';

describe('AccountNumberGenerator', () => {
  describe('generate', () => {
    it('should generate a 10-digit account number', () => {
      const generator = new SimpleAccountNumberGenerator();
      const accountNumber = generator.generate();

      expect(accountNumber).toMatch(/^\d{10}$/);
    });

    it('should generate unique account numbers', () => {
      const generator = new SimpleAccountNumberGenerator();
      const accountNumbers = new Set();

      // Generate 100 account numbers and check for uniqueness
      for (let i = 0; i < 100; i++) {
        const accountNumber = generator.generate();
        expect(accountNumbers.has(accountNumber)).toBe(false);
        accountNumbers.add(accountNumber);
      }
    });

    it('should generate account numbers with only digits', () => {
      const generator = new SimpleAccountNumberGenerator();

      for (let i = 0; i < 10; i++) {
        const accountNumber = generator.generate();
        expect(accountNumber).toMatch(/^\d+$/);
        expect(accountNumber.length).toBe(10);
      }
    });

    it('should generate different numbers on subsequent calls', () => {
      const generator = new SimpleAccountNumberGenerator();
      const first = generator.generate();
      const second = generator.generate();

      expect(first).not.toBe(second);
    });

    it('should avoid reserved account numbers', () => {
      const generator = new SimpleAccountNumberGenerator();
      for (let i = 0; i < 50; i++) {
        const accountNumber = generator.generate();
        expect(accountNumber).not.toBe(FUNDING_SOURCE.ACCOUNT_NUMBER);
        expect(accountNumber).not.toBe(CARD_SETTLEMENT.ACCOUNT_NUMBER);
      }
    });

    it('should handle timestamp encoding correctly', () => {
      const generator = new SimpleAccountNumberGenerator();
      const accountNumber = generator.generate();

      // Verify it's a valid 10-digit number
      expect(parseInt(accountNumber, 10)).toBeGreaterThan(0);
      expect(accountNumber.length).toBe(10);
    });
  });
});
