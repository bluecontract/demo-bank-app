import { describe, it, expect, vi } from 'vitest';
import { Transaction } from './Transaction';
import { Posting } from '../valueObjects/Posting';
import { Money } from '../valueObjects/Money';
import { InvalidTransactionError, UnbalancedTransactionError } from '../errors';
import { FUNDING_SOURCE } from './Account';

const TEST_ACCOUNT_NUMBER_1 = '1234567890';
const TEST_ACCOUNT_NUMBER_2 = '0987654321';

describe('Transaction', () => {
  describe('constructor', () => {
    it('should create a valid funding transaction', () => {
      const postings = [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(100),
          side: 'DEBIT',
          accountNumber: FUNDING_SOURCE.ACCOUNT_NUMBER,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
        }),
        new Posting({
          accountId: 'system-funding',
          amount: new Money(100),
          side: 'CREDIT',
          accountNumber: TEST_ACCOUNT_NUMBER_1,
          counterpartyAccountNumber: FUNDING_SOURCE.ACCOUNT_NUMBER,
        }),
      ];

      const transaction = new Transaction({
        id: 'txn-123',
        type: 'FUNDING',
        status: 'POSTED',
        description: 'Funding source',
        postings,
        createdAt: new Date('2024-01-01'),
      });

      expect(transaction.id).toBe('txn-123');
      expect(transaction.type).toBe('FUNDING');
      expect(transaction.status).toBe('POSTED');
      expect(transaction.postings).toEqual(postings);
      expect(transaction.createdAt).toEqual(new Date('2024-01-01'));
      expect(transaction.transactionIdempotencyKey).toBeUndefined();
    });

    it('should create a valid transfer transaction', () => {
      const postings = [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(100),
          side: 'CREDIT',
          accountNumber: TEST_ACCOUNT_NUMBER_1,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
        }),
        new Posting({
          accountId: 'acc-456',
          amount: new Money(100),
          side: 'DEBIT',
          accountNumber: TEST_ACCOUNT_NUMBER_2,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
        }),
      ];

      const transaction = new Transaction({
        id: 'txn-456',
        type: 'TRANSFER',
        status: 'POSTED',
        postings,
        description: `Transfer from account ${TEST_ACCOUNT_NUMBER_1} to ${TEST_ACCOUNT_NUMBER_2}`,
        transactionIdempotencyKey: 'key-123',
        createdAt: new Date('2024-01-01'),
      });

      expect(transaction.id).toBe('txn-456');
      expect(transaction.type).toBe('TRANSFER');
      expect(transaction.transactionIdempotencyKey).toBe('key-123');
    });

    it('should throw InvalidTransactionError error for empty id', () => {
      const postings = [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(100),
          side: 'DEBIT',
          accountNumber: TEST_ACCOUNT_NUMBER_1,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
        }),
        new Posting({
          accountId: 'acc-456',
          amount: new Money(100),
          side: 'CREDIT',
          accountNumber: TEST_ACCOUNT_NUMBER_2,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
        }),
      ];

      expect(
        () =>
          new Transaction({
            id: '',
            type: 'FUNDING',
            status: 'POSTED',
            description: 'Test',
            postings,
            createdAt: new Date(),
          })
      ).toThrow(
        new InvalidTransactionError('id', 'Transaction ID cannot be empty')
      );
    });

    it('should throwInvalidTransactionError error for empty postings', () => {
      expect(
        () =>
          new Transaction({
            id: 'txn-123',
            type: 'FUNDING',
            status: 'POSTED',
            description: 'Test',
            postings: [],
            createdAt: new Date(),
          })
      ).toThrow(
        new InvalidTransactionError(
          'postings',
          'Transaction must have at least one posting'
        )
      );
    });

    it('should throwInvalidTransactionError error for unbalanced postings', () => {
      const postings = [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(100),
          side: 'DEBIT',
          accountNumber: TEST_ACCOUNT_NUMBER_1,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
        }),
        new Posting({
          accountId: 'acc-456',
          amount: new Money(200),
          side: 'CREDIT',
          accountNumber: TEST_ACCOUNT_NUMBER_2,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
        }),
      ];

      expect(
        () =>
          new Transaction({
            id: 'txn-123',
            type: 'FUNDING',
            status: 'POSTED',
            description: 'Test',
            postings,
            createdAt: new Date(),
          })
      ).toThrow(
        new InvalidTransactionError(
          'postings',
          'Transaction debits (100) must equal credits (200)'
        )
      );
    });

    it('should throw InvalidTransactionError error for all debit postings', () => {
      const postings = [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(100),
          side: 'DEBIT',
          accountNumber: TEST_ACCOUNT_NUMBER_1,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
        }),
        new Posting({
          accountId: 'acc-456',
          amount: new Money(100),
          side: 'DEBIT',
          accountNumber: TEST_ACCOUNT_NUMBER_2,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
        }),
      ];

      expect(
        () =>
          new Transaction({
            id: 'txn-123',
            type: 'FUNDING',
            status: 'POSTED',
            description: 'Test',
            postings,
            createdAt: new Date(),
          })
      ).toThrow(
        new InvalidTransactionError(
          'postings',
          'Transaction debits (200) must equal credits (0)'
        )
      );
    });

    it('should throw InvalidTransactionError error for all credit postings', () => {
      const postings = [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(100),
          side: 'CREDIT',
          accountNumber: TEST_ACCOUNT_NUMBER_1,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
        }),
        new Posting({
          accountId: 'acc-456',
          amount: new Money(100),
          side: 'CREDIT',
          accountNumber: TEST_ACCOUNT_NUMBER_2,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
        }),
      ];

      expect(
        () =>
          new Transaction({
            id: 'txn-123',
            type: 'FUNDING',
            status: 'POSTED',
            description: 'Test',
            postings,
            createdAt: new Date(),
          })
      ).toThrow(
        new InvalidTransactionError(
          'postings',
          'Transaction debits (0) must equal credits (200)'
        )
      );
    });
  });

  describe('equals', () => {
    it('should be equal for same properties', () => {
      const postings = [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(100),
          side: 'DEBIT',
          accountNumber: TEST_ACCOUNT_NUMBER_1,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
        }),
        new Posting({
          accountId: 'acc-456',
          amount: new Money(100),
          side: 'CREDIT',
          accountNumber: TEST_ACCOUNT_NUMBER_2,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
        }),
      ];

      const createdAt = new Date('2024-01-01');
      const transaction1 = new Transaction({
        id: 'txn-123',
        type: 'FUNDING',
        status: 'POSTED',
        postings,
        description: 'Test',
        createdAt,
      });

      const transaction2 = new Transaction({
        id: 'txn-123',
        type: 'FUNDING',
        status: 'POSTED',
        postings,
        description: 'Test',
        createdAt,
      });

      expect(transaction1.equals(transaction2)).toBe(true);
    });

    it('should not be equal for different IDs', () => {
      const postings = [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(100),
          side: 'DEBIT',
          accountNumber: TEST_ACCOUNT_NUMBER_1,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
        }),
        new Posting({
          accountId: 'acc-456',
          amount: new Money(100),
          side: 'CREDIT',
          accountNumber: TEST_ACCOUNT_NUMBER_2,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
        }),
      ];

      const createdAt = new Date('2024-01-01');
      const transaction1 = new Transaction({
        id: 'txn-123',
        type: 'FUNDING',
        status: 'POSTED',
        postings,
        description: 'Test',
        createdAt,
      });

      const transaction2 = new Transaction({
        id: 'txn-456',
        type: 'FUNDING',
        status: 'POSTED',
        postings,
        description: 'Test',
        createdAt,
      });

      expect(transaction1.equals(transaction2)).toBe(false);
    });
  });

  describe('createWithId', () => {
    const postings = [
      new Posting({
        accountId: 'acc-123',
        amount: new Money(100),
        side: 'DEBIT',
        accountNumber: TEST_ACCOUNT_NUMBER_1,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
      }),
      new Posting({
        accountId: 'acc-456',
        amount: new Money(100),
        side: 'CREDIT',
        accountNumber: TEST_ACCOUNT_NUMBER_2,
        counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
      }),
    ];

    it('should create a transaction matching create semantics with provided id', () => {
      const meta = {
        description: 'Transfer with known id',
        idempotencyKey: 'idem-123',
      };

      vi.useFakeTimers();
      const frozen = new Date('2024-01-02T00:00:00.000Z');
      vi.setSystemTime(frozen);

      try {
        const withId = Transaction.createWithId(postings, meta, 'txn-known');
        const generated = Transaction.create(postings, meta);

        expect(withId.id).toBe('txn-known');
        expect(withId.type).toBe(generated.type);
        expect(withId.status).toBe(generated.status);
        expect(withId.postings).toEqual(generated.postings);
        expect(withId.description).toBe(generated.description);
        expect(withId.transactionIdempotencyKey).toBe(
          generated.transactionIdempotencyKey
        );
        expect(withId.createdAt).toEqual(generated.createdAt);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should enforce balance validation', () => {
      const unbalancedPostings = [
        new Posting({
          accountId: 'acc-123',
          amount: new Money(100),
          side: 'DEBIT',
          accountNumber: TEST_ACCOUNT_NUMBER_1,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_2,
        }),
        new Posting({
          accountId: 'acc-456',
          amount: new Money(200),
          side: 'CREDIT',
          accountNumber: TEST_ACCOUNT_NUMBER_2,
          counterpartyAccountNumber: TEST_ACCOUNT_NUMBER_1,
        }),
      ];

      expect(() =>
        Transaction.createWithId(
          unbalancedPostings,
          { description: 'Invalid', idempotencyKey: 'invalid' },
          'txn-invalid'
        )
      ).toThrow(UnbalancedTransactionError);
    });
  });
});
