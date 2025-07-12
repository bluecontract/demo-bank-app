import { describe, it, expect } from 'vitest';
import { Posting } from './Posting';
import { Money } from './Money';
import { InvalidMoneyAmountError, InvalidPostingError } from '../errors';

const TEST_ACCOUNT_NUMBER_1 = '1234567890';
const TEST_ACCOUNT_NUMBER_2 = '0987654321';

describe('Posting', () => {
  describe('constructor', () => {
    it('should create a valid debit posting', () => {
      const posting = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      expect(posting.accountId).toBe('acc-123');
      expect(posting.amount.toCents()).toBe(100);
      expect(posting.side).toBe('DEBIT');
      expect(posting.accountNumber).toBe(TEST_ACCOUNT_NUMBER_1);
      expect(posting.counterpartyAccountNumber).toBe(TEST_ACCOUNT_NUMBER_2);
    });

    it('should create a valid credit posting', () => {
      const posting = new Posting({
        accountId: 'acc-456',
        amount: new Money(200),
        side: 'CREDIT',
        accountNumber: TEST_ACCOUNT_NUMBER_2,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
      });

      expect(posting.accountId).toBe('acc-456');
      expect(posting.amount.toCents()).toBe(200);
      expect(posting.side).toBe('CREDIT');
      expect(posting.accountNumber).toBe(TEST_ACCOUNT_NUMBER_2);
      expect(posting.counterpartyAccountNumber).toBe(TEST_ACCOUNT_NUMBER_1);
    });

    it('should create a posting with destination account number', () => {
      const posting = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      expect(posting.counterpartyAccountNumber).toBe(TEST_ACCOUNT_NUMBER_2);
    });

    it('should throw error for empty account ID', () => {
      expect(
        () =>
          new Posting({
            accountId: '',
            amount: new Money(100),
            side: 'DEBIT',
            accountNumber: TEST_ACCOUNT_NUMBER_1,
            counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
          })
      ).toThrow(
        new InvalidPostingError('accountId', 'Account ID cannot be empty')
      );
    });

    it('should throw error for empty account number', () => {
      expect(
        () =>
          new Posting({
            accountId: 'acc-123',
            amount: new Money(100),
            side: 'DEBIT',
            accountNumber: '',
            counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
          })
      ).toThrow(
        new InvalidPostingError(
          'accountNumber',
          'Account number cannot be empty'
        )
      );
    });

    it('should throw error for empty counterparty account number', () => {
      expect(
        () =>
          new Posting({
            accountId: 'acc-123',
            amount: new Money(100),
            side: 'DEBIT',
            accountNumber: TEST_ACCOUNT_NUMBER_1,
            counterpartyAccountNumber: '',
          })
      ).toThrow(
        new InvalidPostingError(
          'counterpartyAccountNumber',
          'Counterparty account number cannot be empty'
        )
      );
    });

    it('should throw error for zero amount', () => {
      expect(
        () =>
          new Posting({
            accountId: 'acc-123',
            amount: Money.ZERO,
            side: 'DEBIT',
            accountNumber: TEST_ACCOUNT_NUMBER_1,
            counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
          })
      ).toThrow(new InvalidPostingError('amount', 'Amount must be positive'));
    });

    it('should throw error for negative amount', () => {
      // Since Money doesn't allow negative amounts in constructor,
      // we test that subtract operation itself throws when result would be negative
      expect(() => new Money(100).subtract(new Money(200))).toThrow(
        new InvalidMoneyAmountError(-100)
      );
    });
  });

  describe('equality', () => {
    it('should be equal for same properties', () => {
      const posting1 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      const posting2 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      expect(posting1.equals(posting2)).toBe(true);
    });

    it('should not be equal for different account IDs', () => {
      const posting1 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      const posting2 = new Posting({
        accountId: 'acc-456',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      expect(posting1.equals(posting2)).toBe(false);
    });

    it('should not be equal for different amounts', () => {
      const posting1 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      const posting2 = new Posting({
        accountId: 'acc-123',
        amount: new Money(200),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      expect(posting1.equals(posting2)).toBe(false);
    });

    it('should not be equal for different sides', () => {
      const posting1 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      const posting2 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'CREDIT',
        accountNumber: TEST_ACCOUNT_NUMBER_2,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
      });

      expect(posting1.equals(posting2)).toBe(false);
    });

    it('should not be equal for different account numbers', () => {
      const posting1 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      const posting2 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_2,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      expect(posting1.equals(posting2)).toBe(false);
    });

    it('should not be equal for different counterparty account numbers', () => {
      const posting1 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      });

      const posting2 = new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
      });

      expect(posting1.equals(posting2)).toBe(false);
    });
  });
});
