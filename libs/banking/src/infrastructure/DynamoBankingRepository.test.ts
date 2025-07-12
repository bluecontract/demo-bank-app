import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DynamoBankingRepository,
  TransactionHeaderItem,
} from './DynamoBankingRepository';
import { Account } from '../domain/entities/Account';
import { Money } from '../domain/valueObjects/Money';
import { Transaction } from '../domain/entities/Transaction';
import { Posting } from '../domain/valueObjects/Posting';
import {
  AccountDataCorruptedError,
  OptimisticLockError,
  TransactionIdempotencyRecordNotFoundError,
} from '../domain/errors/BankingErrors';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  AccountBalanceItem,
  AccountMetaItem,
  PostingItem,
} from './DynamoBankingRepository';

// Mock AWS SDK
const mockSend = vi.fn();
const mockDynamoDBDocumentClient = {
  send: mockSend,
};

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => mockDynamoDBDocumentClient),
  },
  PutCommand: vi.fn(),
  GetCommand: vi.fn(),
  QueryCommand: vi.fn(),
  TransactWriteCommand: vi.fn(),
  UpdateCommand: vi.fn(),
  BatchGetCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', async importOriginal => {
  const actual = await importOriginal<
    typeof import('@aws-sdk/client-dynamodb')
  >();
  return {
    ...actual,
    TransactionCanceledException: actual.TransactionCanceledException,
  };
});

// Get typed access to mocked constructors
const { GetCommand, QueryCommand, TransactWriteCommand, BatchGetCommand } =
  await import('@aws-sdk/lib-dynamodb');
const mockGetCommand = vi.mocked(GetCommand);
const mockQueryCommand = vi.mocked(QueryCommand);
const mockTransactWriteCommand = vi.mocked(TransactWriteCommand);
const mockBatchGetCommand = vi.mocked(BatchGetCommand);

// Helper function to create test accounts with default balance and version
const createTestAccount = (overrides = {}) => {
  return new Account({
    id: 'acc-123',
    accountNumber: '1234567890',
    name: 'Test Account',
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

describe('DynamoBankingRepository', () => {
  let repository: DynamoBankingRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new DynamoBankingRepository({
      tableName: 'test-banking-table',
      region: 'us-east-1',
    });
  });

  describe('saveAccount', () => {
    it('should save a new account successfully', async () => {
      const account = createTestAccount({
        name: 'My Savings Account',
      });

      mockSend.mockResolvedValueOnce({});

      const savedAccount = await repository.saveAccount(account);

      expect(savedAccount).toBe(account);
      expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should include account name in saved data', async () => {
      const account = createTestAccount({
        name: 'Business Checking',
      });

      mockSend.mockResolvedValueOnce({});

      await repository.saveAccount(account);

      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: expect.arrayContaining([
            expect.objectContaining({
              Put: expect.objectContaining({
                Item: expect.objectContaining({
                  name: 'Business Checking',
                }),
              }),
            }),
          ]),
        })
      );
    });

    it('should save account with correct GSI keys', async () => {
      const account = createTestAccount();

      mockSend.mockResolvedValueOnce({});

      await repository.saveAccount(account);

      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: expect.arrayContaining([
            expect.objectContaining({
              Put: expect.objectContaining({
                Item: expect.objectContaining({
                  BANKING_GSI1PK: 'USER#user-456',
                  BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
                }),
              }),
            }),
          ]),
        })
      );
    });

    it('should save account with balance data', async () => {
      const account = new Account({
        id: 'acc-123',
        accountNumber: '1234567890',
        name: 'Test Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date('2024-01-01'),
        ledgerBalanceMinor: new Money(500),
        availableBalanceMinor: new Money(500),
        balanceVersion: 1,
      });

      mockSend.mockResolvedValueOnce({});

      await repository.saveAccount(account);

      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: expect.arrayContaining([
            expect.objectContaining({
              Put: expect.objectContaining({
                Item: expect.objectContaining({
                  PK: 'ACCOUNT#acc-123',
                  SK: 'BALANCE',
                  ledgerBalanceMinor: 500,
                  availableBalanceMinor: 500,
                  version: 1,
                }),
              }),
            }),
          ]),
        })
      );
    });

    it('should rethrow AWS SDK errors', async () => {
      const account = createTestAccount();

      const awsError = new Error('DynamoDB service error');
      mockSend.mockRejectedValueOnce(awsError);

      await expect(repository.saveAccount(account)).rejects.toThrow(
        'DynamoDB service error'
      );
      expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle account with test flag', async () => {
      const account = createTestAccount({
        isTest: true,
      });

      mockSend.mockResolvedValueOnce({});

      await repository.saveAccount(account);

      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: expect.arrayContaining([
            expect.objectContaining({
              Put: expect.objectContaining({
                Item: expect.objectContaining({
                  isTest: true,
                }),
              }),
            }),
          ]),
        })
      );
    });

    it('should use conditional expression to prevent overwrites', async () => {
      const account = createTestAccount();

      mockSend.mockResolvedValueOnce({});

      await repository.saveAccount(account);

      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: expect.arrayContaining([
            expect.objectContaining({
              Put: expect.objectContaining({
                ConditionExpression: 'attribute_not_exists(SK)',
              }),
            }),
          ]),
        })
      );
    });

    it('should create account number reservation item', async () => {
      const account = createTestAccount();

      mockSend.mockResolvedValueOnce({});

      await repository.saveAccount(account);

      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: expect.arrayContaining([
            expect.objectContaining({
              Put: expect.objectContaining({
                Item: expect.objectContaining({
                  PK: 'ACCOUNT_NUMBER#1234567890',
                  SK: 'RESERVE',
                  accountId: 'acc-123',
                }),
                ConditionExpression: 'attribute_not_exists(SK)',
              }),
            }),
          ]),
        })
      );
    });

    it('should create exactly three items in transaction', async () => {
      const account = createTestAccount();

      mockSend.mockResolvedValueOnce({});

      await repository.saveAccount(account);

      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: expect.arrayContaining([
            expect.objectContaining({
              Put: expect.objectContaining({
                Item: expect.objectContaining({
                  PK: 'ACCOUNT#acc-123',
                  SK: 'META',
                }),
              }),
            }),
            expect.objectContaining({
              Put: expect.objectContaining({
                Item: expect.objectContaining({
                  PK: 'ACCOUNT#acc-123',
                  SK: 'BALANCE',
                }),
              }),
            }),
            expect.objectContaining({
              Put: expect.objectContaining({
                Item: expect.objectContaining({
                  PK: 'ACCOUNT_NUMBER#1234567890',
                  SK: 'RESERVE',
                }),
              }),
            }),
          ]),
        })
      );
      expect(
        mockTransactWriteCommand.mock.calls[0][0].TransactItems
      ).toHaveLength(3);
    });
  });

  describe('saveTransactionWithAccounts', () => {
    const createTestTransaction = () => {
      const debitPosting = new Posting({
        accountId: 'acc-123',
        amount: new Money(1000),
        side: 'DEBIT',
        accountNumber: '1111111111',
        counterpartyAccountNumber: '2222222222',
      });

      const creditPosting = new Posting({
        accountId: 'acc-456',
        amount: new Money(1000),
        side: 'CREDIT',
        accountNumber: '2222222222',
        counterpartyAccountNumber: '1111111111',
      });

      return Transaction.create([debitPosting, creditPosting], {
        description: 'Test transfer',
        idempotencyKey: 'test-key-123',
      });
    };

    const createTestAccounts = () => {
      const sourceAccount = new Account({
        id: 'acc-123',
        accountNumber: '1111111111',
        name: 'Source Account',
        ownerUserId: 'user-123',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(5000),
        availableBalanceMinor: new Money(5000),
        balanceVersion: 1,
      });

      const targetAccount = new Account({
        id: 'acc-456',
        accountNumber: '2222222222',
        name: 'Target Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(0),
        availableBalanceMinor: new Money(0),
        balanceVersion: 2,
      });

      // Apply postings to create pending deltas
      sourceAccount.applyPosting(
        new Posting({
          accountId: 'acc-123',
          amount: new Money(1000),
          side: 'DEBIT',
          accountNumber: '1111111111',
          counterpartyAccountNumber: '2222222222',
        })
      );

      targetAccount.applyPosting(
        new Posting({
          accountId: 'acc-456',
          amount: new Money(1000),
          side: 'CREDIT',
          accountNumber: '2222222222',
          counterpartyAccountNumber: '1111111111',
        })
      );

      return [sourceAccount, targetAccount];
    };

    it('should save transaction without idempotency key', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      mockSend.mockResolvedValueOnce({});

      const result = await repository.saveTransactionWithAccounts(
        transaction,
        accounts,
        { userId: 'user-123', idempotencyKey: '' }
      );

      expect(result).toBe(transaction.id);
      expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);

      const transactItems =
        mockTransactWriteCommand.mock.calls[0][0].TransactItems;
      // Should have: transaction header + 2 postings + 2 account balance updates = 5 items
      expect(transactItems).toHaveLength(5);

      // Verify transaction header
      expect(transactItems![0]?.Put?.Item).toMatchObject({
        PK: `TXN#${transaction.id}`,
        SK: 'META',
        type: transaction.type,
        status: transaction.status,
        description: 'Test transfer',
        transactionId: transaction.id,
      });

      // Verify postings
      expect(transactItems![1]?.Put?.Item?.SK).toBe('POST#0');
      expect(transactItems![2]?.Put?.Item?.SK).toBe('POST#1');

      // Verify account balance updates
      expect(transactItems![3]?.Update?.Key).toMatchObject({
        PK: 'ACCOUNT#acc-123',
        SK: 'BALANCE',
      });
      expect(transactItems![4]?.Update?.Key).toMatchObject({
        PK: 'ACCOUNT#acc-456',
        SK: 'BALANCE',
      });
    });

    it('should save transaction with idempotency key', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      mockSend.mockResolvedValueOnce({});

      const result = await repository.saveTransactionWithAccounts(
        transaction,
        accounts,
        { userId: 'user-123', idempotencyKey: 'test-key-123' }
      );

      expect(result).toBe(transaction.id);

      const transactItems =
        mockTransactWriteCommand.mock.calls[0][0].TransactItems;
      // Should have: idempotency record + transaction header + 2 postings + 2 account balance updates = 6 items
      expect(transactItems).toHaveLength(6);

      // Verify idempotency record comes first
      expect(transactItems![0]?.Put?.Item).toMatchObject({
        PK: 'USER#user-123',
        SK: expect.stringMatching(/^IDEMPOTENCY#/),
        transactionId: transaction.id,
      });
      expect(transactItems![0]?.Put?.Item?.ttl).toBeGreaterThan(
        Math.floor(Date.now() / 1000)
      );
    });

    it('should skip account updates when delta is zero', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      // Reset pending deltas to zero
      accounts.forEach(account => account.flushPendingDelta());

      mockSend.mockResolvedValueOnce({});

      await repository.saveTransactionWithAccounts(transaction, accounts, {
        userId: 'user-123',
        idempotencyKey: 'test-key-123',
      });

      const transactItems =
        mockTransactWriteCommand.mock.calls[0][0].TransactItems;
      // Should have: transaction header + 2 postings + idempotency record = 4 items (no account updates)
      expect(transactItems).toHaveLength(4);
      expect(transactItems!.every(item => !item.Update)).toBe(true);
    });

    it('should handle idempotency conflicts by returning existing transaction ID', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      const idempotencyError = new TransactionCanceledException({
        message: 'Transaction cancelled',
        CancellationReasons: [
          { Code: 'ConditionalCheckFailed' }, // idempotency record
          {}, // transaction header
          {}, // posting 1
          {}, // posting 2
          {}, // account balance update 1 (source)
          {}, // account balance update 2 (target)
        ],
        $metadata: {},
      });

      mockSend.mockRejectedValueOnce(idempotencyError);
      mockSend.mockResolvedValueOnce({
        Item: { transactionId: 'existing-txn-123' },
      });

      const result = await repository.saveTransactionWithAccounts(
        transaction,
        accounts,
        { userId: 'user-123', idempotencyKey: 'test-key-123' }
      );

      expect(result).toBe('existing-txn-123');
      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: {
            PK: 'USER#user-123',
            SK: expect.stringMatching(/^IDEMPOTENCY#/),
          },
          ConsistentRead: true,
        })
      );
    });

    it('should throw OptimisticLockError when transaction already exists', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      const optimisticLockError = new TransactionCanceledException({
        message: 'Transaction cancelled',
        CancellationReasons: [
          {}, // idempotency record
          { Code: 'ConditionalCheckFailed' }, // transaction header
          {}, // posting 1
          {}, // posting 2
          {}, // account balance update 1 (source)
          {}, // account balance update 2 (target)
        ],
        $metadata: {},
      });

      mockSend.mockRejectedValueOnce(optimisticLockError);

      await expect(
        repository.saveTransactionWithAccounts(transaction, accounts, {
          userId: 'user-123',
          idempotencyKey: 'test-key-123',
        })
      ).rejects.toThrow(OptimisticLockError);
    });

    it('should throw OptimisticLockError transaction posting exists', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      const optimisticLockError = new TransactionCanceledException({
        message: 'Transaction cancelled',
        CancellationReasons: [
          {}, // idempotency record
          {}, // transaction header
          { Code: 'ConditionalCheckFailed' }, // posting 1
          {}, // posting 2
          {}, // account balance update 1 (source)
          {}, // account balance update 2 (target)
        ],
        $metadata: {},
      });

      mockSend.mockRejectedValueOnce(optimisticLockError);

      await expect(
        repository.saveTransactionWithAccounts(transaction, accounts, {
          userId: 'user-123',
          idempotencyKey: 'test-key-123',
        })
      ).rejects.toThrow(OptimisticLockError);
    });

    it('should throw OptimisticLockError when balance version is not matching', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      const optimisticLockError = new TransactionCanceledException({
        message: 'Transaction cancelled',
        CancellationReasons: [
          {}, // idempotency record
          {}, // transaction header
          {}, // posting 1
          {}, // posting 2
          {}, // account balance update 2
          { Code: 'ConditionalCheckFailed' },
        ],
        $metadata: {},
      });

      mockSend.mockRejectedValueOnce(optimisticLockError);

      await expect(
        repository.saveTransactionWithAccounts(transaction, accounts, {
          userId: 'user-123',
          idempotencyKey: 'test-key-123',
        })
      ).rejects.toThrow(OptimisticLockError);
    });

    it('should rethrow generic AWS SDK errors', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      const awsError = new Error('DynamoDB service error');
      mockSend.mockRejectedValueOnce(awsError);

      await expect(
        repository.saveTransactionWithAccounts(transaction, accounts, {
          userId: 'user-123',
          idempotencyKey: 'test-key-123',
        })
      ).rejects.toThrow('DynamoDB service error');
    });

    it('should flush pending deltas on successful save', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      // Verify accounts have pending deltas before save
      expect(accounts[0].pendingDelta.ledger).not.toBe(0);
      expect(accounts[1].pendingDelta.ledger).not.toBe(0);

      mockSend.mockResolvedValueOnce({});

      await repository.saveTransactionWithAccounts(transaction, accounts, {
        userId: 'user-123',
        idempotencyKey: 'test-key-123',
      });

      // Verify pending deltas are flushed after successful save
      expect(accounts[0].pendingDelta.ledger).toBe(0);
      expect(accounts[0].pendingDelta.available).toBe(0);
      expect(accounts[1].pendingDelta.ledger).toBe(0);
      expect(accounts[1].pendingDelta.available).toBe(0);
    });

    it('should include correct posting data in saved items', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      mockSend.mockResolvedValueOnce({});

      await repository.saveTransactionWithAccounts(transaction, accounts, {
        userId: 'user-123',
        idempotencyKey: 'test-key-123',
      });

      const transactItems =
        mockTransactWriteCommand.mock.calls[0][0].TransactItems;
      const posting1 = transactItems![2]?.Put?.Item;
      const posting2 = transactItems![3]?.Put?.Item;

      expect(posting1).toMatchObject({
        PK: `TXN#${transaction.id}`,
        SK: 'POST#0',
        BANKING_GSI2PK: 'ACCOUNT#acc-123',
        BANKING_GSI2SK: expect.stringMatching(/^POST#/),
        accountId: 'acc-123',
        amount: 1000,
        side: 'DEBIT',
        accountNumber: '1111111111',
        counterpartyAccountNumber: '2222222222',
      });

      expect(posting2).toMatchObject({
        PK: `TXN#${transaction.id}`,
        SK: 'POST#1',
        BANKING_GSI2PK: 'ACCOUNT#acc-456',
        accountId: 'acc-456',
        amount: 1000,
        side: 'CREDIT',
        accountNumber: '2222222222',
        counterpartyAccountNumber: '1111111111',
      });
    });

    it('should include correct balance update expressions', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      mockSend.mockResolvedValueOnce({});

      await repository.saveTransactionWithAccounts(transaction, accounts, {
        userId: 'user-123',
        idempotencyKey: 'test-key-123',
      });

      const transactItems =
        mockTransactWriteCommand.mock.calls[0][0].TransactItems;
      const balanceUpdate1 = transactItems![4]?.Update;
      const balanceUpdate2 = transactItems![5]?.Update;

      expect(balanceUpdate1).toMatchObject({
        UpdateExpression:
          'ADD ledgerBalanceMinor :ledger, availableBalanceMinor :available SET #version = #version + :inc',
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeValues: {
          ':ledger': -1000, // Debit reduces balance
          ':available': -1000,
          ':currentVersion': 1,
          ':inc': 1,
        },
      });

      expect(balanceUpdate2).toMatchObject({
        UpdateExpression:
          'ADD ledgerBalanceMinor :ledger, availableBalanceMinor :available SET #version = #version + :inc',
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeValues: {
          ':ledger': 1000, // Credit increases balance
          ':available': 1000,
          ':currentVersion': 2,
          ':inc': 1,
        },
      });
    });

    it('should throw TransactionIdempotencyRecordNotFoundError during conflict resolution', async () => {
      const transaction = createTestTransaction();
      const accounts = createTestAccounts();

      const idempotencyError = new TransactionCanceledException({
        message: 'Transaction cancelled',
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
        $metadata: {},
      });

      mockSend.mockRejectedValueOnce(idempotencyError);
      mockSend.mockResolvedValueOnce({ Item: null }); // No idempotency record found

      await expect(
        repository.saveTransactionWithAccounts(transaction, accounts, {
          userId: 'user-123',
          idempotencyKey: 'test-key-123',
        })
      ).rejects.toThrow(TransactionIdempotencyRecordNotFoundError);
    });
  });

  describe('getAccountById', () => {
    it('should return account with balance information when found', async () => {
      const accountData: AccountMetaItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
        accountNumber: '1234567890',
        name: 'My Savings Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const balanceData: AccountBalanceItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'BALANCE',
        ledgerBalanceMinor: 150000, // $1,500.00
        availableBalanceMinor: 125000, // $1,250.00
        version: 3,
      };

      // Mock BatchGetCommand to return both meta and balance items
      mockSend.mockResolvedValueOnce({
        Responses: {
          'test-banking-table': [accountData, balanceData],
        },
      });

      const account = await repository.getAccountById('acc-123');

      expect(account).toBeDefined();
      expect(account!.id).toBe('acc-123');
      expect(account!.accountNumber).toBe('1234567890');
      expect(account!.name).toBe('My Savings Account');
      expect(account!.ownerUserId).toBe('user-456');
      expect(account!.status).toBe('ACTIVE');
      expect(account!.currency).toBe('USD');
      expect(account!.ledgerBalanceMinor.toCents()).toBe(150000);
      expect(account!.availableBalanceMinor.toCents()).toBe(125000);
      expect(account!.balanceVersion).toBe(3);
      expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
      expect(mockBatchGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          RequestItems: {
            'test-banking-table': {
              Keys: [
                { PK: 'ACCOUNT#acc-123', SK: 'META' },
                { PK: 'ACCOUNT#acc-123', SK: 'BALANCE' },
              ],
            },
          },
        })
      );
    });

    it('should return null when account not found', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: { 'test-banking-table': [] },
      });

      const account = await repository.getAccountById('nonexistent');

      expect(account).toBeNull();
      expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
    });

    it('should return null when meta item is missing', async () => {
      const balanceData: AccountBalanceItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'BALANCE',
        ledgerBalanceMinor: 150000,
        availableBalanceMinor: 125000,
        version: 3,
      };

      mockSend.mockResolvedValueOnce({
        Responses: { 'test-banking-table': [balanceData] },
      });

      const account = await repository.getAccountById('acc-123');
      expect(account).toBeNull();
    });

    it('should throw AccountDataCorruptedError when balance item is missing', async () => {
      const accountData: AccountMetaItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
        accountNumber: '1234567890',
        name: 'My Savings Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      mockSend.mockResolvedValueOnce({
        Responses: { 'test-banking-table': [accountData] },
      });

      await expect(repository.getAccountById('acc-123')).rejects.toThrow(
        AccountDataCorruptedError
      );
    });

    it('should throw AccountDataCorruptedError when balance item is invalid', async () => {
      const accountData: AccountMetaItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
        accountNumber: '1234567890',
        name: 'My Savings Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const invalidBalanceData = {
        PK: 'ACCOUNT#acc-123',
        SK: 'BALANCE',
        // Missing required balance fields
      };

      mockSend.mockResolvedValueOnce({
        Responses: { 'test-banking-table': [accountData, invalidBalanceData] },
      });

      await expect(repository.getAccountById('acc-123')).rejects.toThrow(
        AccountDataCorruptedError
      );
    });
  });

  describe('getAccountIdByNumber', () => {
    it('should return account when found by account number', async () => {
      const reservationData = {
        PK: 'ACCOUNT_NUMBER#1234567890',
        SK: 'RESERVE',
        accountId: 'acc-123',
      };

      mockSend.mockResolvedValueOnce({
        Item: reservationData,
      });

      const accountId = await repository.getAccountIdByNumber('1234567890');

      expect(accountId).toBe('acc-123');
      expect(mockGetCommand).toHaveBeenCalledTimes(1);
      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-banking-table',
          Key: {
            PK: 'ACCOUNT_NUMBER#1234567890',
            SK: 'RESERVE',
          },
        })
      );
    });

    it('should return null when account number not found', async () => {
      mockSend.mockResolvedValueOnce({
        Item: undefined,
      });

      const account = await repository.getAccountIdByNumber('0000000000');

      expect(account).toBeNull();
      expect(mockGetCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAccountsByUserId', () => {
    it('should return user accounts', async () => {
      const accountData: AccountMetaItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
        accountNumber: '1234567890',
        name: 'Test Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-01T00:00:00.000Z',
        isTest: false,
      };
      const balanceData: AccountBalanceItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'BALANCE',
        ledgerBalanceMinor: 100,
        availableBalanceMinor: 100,
        version: 1,
      };

      mockSend.mockResolvedValueOnce({
        Items: [accountData, balanceData],
        Count: 2,
      });
      const accounts = await repository.getAccountsByUserId('user-456');

      expect(accounts).toHaveLength(1);
      expect(accounts[0].ownerUserId).toBe('user-456');
      expect(accounts[0].name).toBe('Test Account');
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when user has no accounts', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        Count: 0,
      });

      const accounts = await repository.getAccountsByUserId(
        'user-without-accounts'
      );

      expect(accounts).toEqual([]);
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({
        Items: undefined,
        Count: 0,
      });

      const accounts = await repository.getAccountsByUserId('user-456');

      expect(accounts).toEqual([]);
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple accounts for same user', async () => {
      const account1Data: AccountMetaItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
        accountNumber: '1234567890',
        name: 'Savings Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      const balance1Data: AccountBalanceItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'BALANCE',
        ledgerBalanceMinor: 100,
        availableBalanceMinor: 100,
        version: 1,
      };
      const account2Data: AccountMetaItem = {
        PK: 'ACCOUNT#acc-456',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-02T00:00:00.000Z',
        accountNumber: '9876543210',
        name: 'Checking Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-02T00:00:00.000Z',
      };
      const balance2Data: AccountBalanceItem = {
        PK: 'ACCOUNT#acc-456',
        SK: 'BALANCE',
        ledgerBalanceMinor: 500,
        availableBalanceMinor: 500,
        version: 1,
      };

      mockSend.mockResolvedValueOnce({
        Items: [account1Data, balance1Data, account2Data, balance2Data],
        Count: 4,
      });

      const accounts = await repository.getAccountsByUserId('user-456');

      expect(accounts).toHaveLength(2);
      expect(accounts[0].name).toBe('Savings Account');
      expect(accounts[1].name).toBe('Checking Account');
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should rethrow AWS SDK errors', async () => {
      const awsError = new Error('DynamoDB service error');
      mockSend.mockRejectedValueOnce(awsError);

      await expect(repository.getAccountsByUserId('user-456')).rejects.toThrow(
        'DynamoDB service error'
      );
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should throw error if account data is corrupted', async () => {
      const accountData: AccountMetaItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
        accountNumber: '1234567890',
        name: 'My Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      mockSend.mockResolvedValueOnce({
        Items: [accountData],
        Count: 1,
      });

      await expect(repository.getAccountsByUserId('user-456')).rejects.toThrow(
        new AccountDataCorruptedError()
      );

      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should use correct GSI parameters', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        Count: 0,
      });

      await repository.getAccountsByUserId('user-456');

      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-banking-table',
          IndexName: 'BANKING_GSI1',
          KeyConditionExpression: 'BANKING_GSI1PK = :pk',
          ExpressionAttributeValues: {
            ':pk': 'USER#user-456',
          },
        })
      );
    });
  });

  describe('getTransactionsByAccount', () => {
    it('should return transactions for account in reverse chronological order', async () => {
      const transactionData1: PostingItem = {
        PK: 'TXN#txn-123',
        SK: 'POST#1',
        BANKING_GSI2PK: 'ACCOUNT#acc-123',
        BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
        accountId: 'acc-123',
        amount: 100,
        side: 'DEBIT',
        description: 'Test transaction',
        accountNumber: '1234567890',
        counterpartyAccountNumber: '9876543210',
        type: 'TRANSFER',
        status: 'POSTED',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const transactionData2: PostingItem = {
        PK: 'TXN#txn-123',
        SK: 'POST#1',
        BANKING_GSI2PK: 'ACCOUNT#acc-123',
        BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
        accountId: 'acc-123',
        amount: 100,
        side: 'DEBIT',
        description: 'Test transaction',
        accountNumber: '1234567890',
        counterpartyAccountNumber: '9876543210',
        type: 'TRANSFER',
        status: 'POSTED',
        transactionId: 'txn-123',
        createdAt: '2024-01-02T00:00:00.000Z',
      };

      mockSend.mockResolvedValueOnce({
        Items: [transactionData1, transactionData2],
        Count: 2,
        LastEvaluatedKey: undefined,
      });

      const result = await repository.getTransactionsByAccount('acc-123', {
        limit: 10,
      });

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextToken).toBeUndefined();
      expect(result.items[0].transactionId).toBe(
        transactionData1.transactionId
      );
      expect(result.items[0].amount.toCents()).toBe(transactionData1.amount);
      expect(result.items[0].side).toBe(transactionData1.side);
      expect(result.items[1].transactionId).toBe(
        transactionData2.transactionId
      );
      expect(result.items[1].amount.toCents()).toBe(transactionData2.amount);
      expect(result.items[1].side).toBe(transactionData2.side);
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should return empty result when no transactions found', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        LastEvaluatedKey: undefined,
      });

      const result = await repository.getTransactionsByAccount('acc-empty');

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextToken).toBeUndefined();
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle pagination with hasMore true', async () => {
      const transactionData: PostingItem = {
        PK: 'TXN#txn-123',
        SK: 'POST#1',
        BANKING_GSI2PK: 'ACCOUNT#acc-123',
        BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
        accountId: 'acc-123',
        amount: 100,
        side: 'DEBIT',
        description: 'Test transaction',
        accountNumber: '1234567890',
        counterpartyAccountNumber: '9876543210',
        type: 'TRANSFER',
        status: 'COMPLETED',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const lastEvaluatedKey = { PK: 'TXN#txn-123', SK: 'POST#1' };
      mockSend.mockResolvedValueOnce({
        Items: [transactionData],
        Count: 1,
        LastEvaluatedKey: lastEvaluatedKey,
      });

      const result = await repository.getTransactionsByAccount('acc-123', {
        limit: 1,
      });

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.nextToken).toBe(JSON.stringify(lastEvaluatedKey));
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle pagination with nextToken', async () => {
      const transactionData: PostingItem = {
        PK: 'TXN#txn-456',
        SK: 'POST#1',
        BANKING_GSI2PK: 'ACCOUNT#acc-123',
        BANKING_GSI2SK: 'POST#2024-01-02T00:00:00.000Z',
        accountId: 'acc-123',
        amount: 200,
        side: 'CREDIT',
        description: 'Another transaction',
        accountNumber: '1234567890',
        counterpartyAccountNumber: '9876543210',
        type: 'TRANSFER',
        status: 'COMPLETED',
        transactionId: 'txn-456',
        createdAt: '2024-01-02T00:00:00.000Z',
      };

      const exclusiveStartKey = { PK: 'TXN#txn-123', SK: 'POST#1' };
      mockSend.mockResolvedValueOnce({
        Items: [transactionData],
        Count: 1,
        LastEvaluatedKey: undefined,
      });

      const result = await repository.getTransactionsByAccount('acc-123', {
        limit: 10,
        nextToken: JSON.stringify(exclusiveStartKey),
      });

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      expect(result.nextToken).toBeUndefined();
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
    });

    it('should use default limit when not specified', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        LastEvaluatedKey: undefined,
      });

      await repository.getTransactionsByAccount('acc-123');

      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Limit: 50,
        })
      );
    });

    it('should rethrow AWS SDK errors', async () => {
      const awsError = new Error('DynamoDB service error');
      mockSend.mockRejectedValueOnce(awsError);

      await expect(
        repository.getTransactionsByAccount('acc-123')
      ).rejects.toThrow('DynamoDB service error');
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple transactions', async () => {
      const transaction1Data: PostingItem = {
        PK: 'TXN#txn-123',
        SK: 'POST#1',
        BANKING_GSI2PK: 'ACCOUNT#acc-123',
        BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
        accountId: 'acc-123',
        amount: 100,
        side: 'DEBIT',
        description: 'First transaction',
        accountNumber: '1234567890',
        counterpartyAccountNumber: '9876543210',
        type: 'TRANSFER',
        status: 'COMPLETED',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const transaction2Data: PostingItem = {
        PK: 'TXN#txn-456',
        SK: 'POST#1',
        BANKING_GSI2PK: 'ACCOUNT#acc-123',
        BANKING_GSI2SK: 'POST#2024-01-02T00:00:00.000Z',
        accountId: 'acc-123',
        amount: 200,
        side: 'CREDIT',
        description: 'Second transaction',
        accountNumber: '1234567890',
        counterpartyAccountNumber: '9876543210',
        type: 'DEPOSIT',
        status: 'COMPLETED',
        transactionId: 'txn-456',
        createdAt: '2024-01-02T00:00:00.000Z',
      };

      mockSend.mockResolvedValueOnce({
        Items: [transaction1Data, transaction2Data],
        Count: 2,
        LastEvaluatedKey: undefined,
      });

      const result = await repository.getTransactionsByAccount('acc-123');

      expect(result.items).toHaveLength(2);
      expect(result.items[0].transactionId).toBe('txn-123');
      expect(result.items[1].transactionId).toBe('txn-456');
      expect(result.items[0].type).toBe('TRANSFER');
      expect(result.items[1].type).toBe('DEPOSIT');
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle undefined Items array', async () => {
      mockSend.mockResolvedValueOnce({
        Items: undefined,
        Count: 0,
        LastEvaluatedKey: undefined,
      });

      const result = await repository.getTransactionsByAccount('acc-123');

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextToken).toBeUndefined();
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should use correct GSI parameters', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        Count: 0,
        LastEvaluatedKey: undefined,
      });

      await repository.getTransactionsByAccount('acc-123', { limit: 25 });

      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-banking-table',
          IndexName: 'BANKING_GSI2',
          KeyConditionExpression:
            'BANKING_GSI2PK = :pk AND begins_with(BANKING_GSI2SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': 'ACCOUNT#acc-123',
            ':sk': 'POST#',
          },
          ScanIndexForward: false,
          Limit: 25,
        })
      );
    });
  });

  describe('getAccountById', () => {
    it('should load account with balance successfully', async () => {
      const metaData: AccountMetaItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
        accountNumber: '1234567890',
        name: 'Test Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-01T00:00:00.000Z',
        isTest: false,
      };

      const balanceData: AccountBalanceItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'BALANCE',
        ledgerBalanceMinor: 1000,
        availableBalanceMinor: 800,
        version: 5,
      };

      mockSend.mockResolvedValueOnce({
        Responses: {
          'test-banking-table': [metaData, balanceData],
        },
      });

      const account = await repository.getAccountById('acc-123');

      expect(account.id).toBe('acc-123');
      expect(account.name).toBe('Test Account');
      expect(account.ledgerBalanceMinor.toCents()).toBe(1000);
      expect(account.availableBalanceMinor.toCents()).toBe(800);
      expect(account.balanceVersion).toBe(5);
      expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
    });

    it('should throw error if account data is corrupted', async () => {
      const metaData: AccountMetaItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
        accountNumber: '1234567890',
        name: 'Test Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-01T00:00:00.000Z',
        isTest: false,
      };

      mockSend.mockResolvedValueOnce({
        Responses: {
          'test-banking-table': [metaData], // missing balance data
        },
      });

      await expect(repository.getAccountById('acc-123')).rejects.toThrow(
        new AccountDataCorruptedError()
      );

      expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
    });

    it('should resolve null when account does not exist', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: {
          'test-banking-table': [],
        },
      });

      await expect(repository.getAccountById('nonexistent')).resolves.toBe(
        null
      );
      expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
    });

    it('should resolve null when no meta item found', async () => {
      const balanceData: AccountBalanceItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'BALANCE',
        ledgerBalanceMinor: 1000,
        availableBalanceMinor: 800,
        version: 5,
      };

      mockSend.mockResolvedValueOnce({
        Responses: {
          'test-banking-table': [balanceData],
        },
      });

      await expect(repository.getAccountById('acc-123')).resolves.toBe(null);
      expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
    });

    it('should rethrow AWS SDK errors', async () => {
      const awsError = new Error('DynamoDB service error');
      mockSend.mockRejectedValueOnce(awsError);

      await expect(repository.getAccountById('acc-123')).rejects.toThrow(
        'DynamoDB service error'
      );
      expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
    });

    it('should use correct BatchGetCommand parameters', async () => {
      const metaData: AccountMetaItem = {
        PK: 'ACCOUNT#acc-123',
        SK: 'META',
        BANKING_GSI1PK: 'USER#user-456',
        BANKING_GSI1SK: '2024-01-01T00:00:00.000Z',
        accountNumber: '1234567890',
        name: 'Test Account',
        ownerUserId: 'user-456',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const balanceData: AccountBalanceItem = {
        PK: 'ACCOUNT#acc-456',
        SK: 'BALANCE',
        ledgerBalanceMinor: 1000,
        availableBalanceMinor: 800,
        version: 5,
      };

      mockSend.mockResolvedValueOnce({
        Responses: {
          'test-banking-table': [metaData, balanceData],
        },
      });

      await repository.getAccountById('acc-456');

      expect(mockBatchGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          RequestItems: {
            'test-banking-table': {
              Keys: [
                { PK: 'ACCOUNT#acc-456', SK: 'META' },
                { PK: 'ACCOUNT#acc-456', SK: 'BALANCE' },
              ],
            },
          },
        })
      );
    });

    it('should return null when Responses is undefined', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: undefined,
      });

      await expect(repository.getAccountById('acc-123')).resolves.toBe(null);
      expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
    });

    it('should resolve null when table is missing in Responses', async () => {
      mockSend.mockResolvedValueOnce({
        Responses: {
          'other-table': [],
        },
      });

      await expect(repository.getAccountById('acc-123')).resolves.toBe(null);
      expect(mockBatchGetCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTransactionById', () => {
    it('should return transaction with postings when found', async () => {
      const headerData: TransactionHeaderItem = {
        PK: 'TXN#txn-123',
        SK: 'META',
        type: 'TRANSFER',
        status: 'COMPLETED',
        description: 'Test transfer',
        transactionId: 'txn-123',
        transactionIdempotencyKey: 'idempotency-key',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const posting1Data: PostingItem = {
        PK: 'TXN#txn-123',
        SK: 'POST#0',
        accountId: 'acc-123',
        amount: 1000,
        side: 'DEBIT',
        accountNumber: '1234567890',
        counterpartyAccountNumber: '9876543210',
        type: 'TRANSFER',
        status: 'POSTED',
        createdAt: '2024-01-01T00:00:00.000Z',
        BANKING_GSI2PK: 'ACCOUNT#acc-123',
        BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
        transactionId: 'txn-123',
        description: 'Test transfer',
      };

      const posting2Data: PostingItem = {
        PK: 'TXN#txn-123',
        SK: 'POST#1',
        accountId: 'acc-456',
        amount: 1000,
        side: 'CREDIT',
        accountNumber: '9876543210',
        counterpartyAccountNumber: '1234567890',
        type: 'TRANSFER',
        status: 'POSTED',
        createdAt: '2024-01-01T00:00:00.000Z',
        BANKING_GSI2PK: 'ACCOUNT#acc-456',
        BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
        transactionId: 'txn-123',
        description: 'Test transfer',
      };

      mockSend.mockResolvedValueOnce({
        Items: [headerData, posting1Data, posting2Data],
        Count: 3,
      });

      const transaction = await repository.getTransactionById('txn-123');

      expect(transaction).toBeDefined();
      expect(transaction!.id).toBe('txn-123');
      expect(transaction!.type).toBe('TRANSFER');
      expect(transaction!.status).toBe('COMPLETED');
      expect(transaction!.description).toBe('Test transfer');
      expect(transaction!.transactionIdempotencyKey).toBe('idempotency-key');
      expect(transaction!.postings).toHaveLength(2);
      expect(transaction!.postings[0].accountId).toBe('acc-123');
      expect(transaction!.postings[0].amount.toCents()).toBe(1000);
      expect(transaction!.postings[0].side).toBe('DEBIT');
      expect(transaction!.postings[1].accountId).toBe('acc-456');
      expect(transaction!.postings[1].side).toBe('CREDIT');
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should return null when transaction not found', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        Count: 0,
      });

      const transaction = await repository.getTransactionById('nonexistent');

      expect(transaction).toBeNull();
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should return null when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({
        Items: undefined,
        Count: 0,
      });

      const transaction = await repository.getTransactionById('txn-123');

      expect(transaction).toBeNull();
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should rethrow transaction constructor errors', async () => {
      const headerData: TransactionHeaderItem = {
        PK: 'TXN#txn-123',
        SK: 'META',
        type: 'TRANSFER',
        status: 'COMPLETED',
        description: 'Test transfer',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      mockSend.mockResolvedValueOnce({
        Items: [headerData],
        Count: 1,
      });

      await expect(repository.getTransactionById('txn-123')).rejects.toThrow(
        'Transaction must have at least one posting'
      );
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should rethrow AWS SDK errors', async () => {
      const awsError = new Error('DynamoDB service error');
      mockSend.mockRejectedValueOnce(awsError);

      await expect(repository.getTransactionById('txn-123')).rejects.toThrow(
        'DynamoDB service error'
      );
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should use correct QueryCommand parameters', async () => {
      const headerData: TransactionHeaderItem = {
        PK: 'TXN#txn-123',
        SK: 'META',
        type: 'TRANSFER',
        status: 'COMPLETED',
        description: 'Test transfer',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const postingData: PostingItem[] = [
        {
          PK: 'TXN#txn-123',
          SK: 'POST#0',
          accountId: 'acc-123',
          amount: 2500,
          side: 'CREDIT',
          accountNumber: '1111111111',
          counterpartyAccountNumber: '2222222222',
          type: 'TRANSFER',
          status: 'POSTED',
          createdAt: '2024-01-01T00:00:00.000Z',
          BANKING_GSI2PK: 'ACCOUNT#acc-123',
          BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
          transactionId: 'txn-123',
          description: 'Test transfer',
        },
        {
          PK: 'TXN#txn-123',
          SK: 'POST#1',
          accountId: 'acc-321',
          amount: 2500,
          side: 'DEBIT',
          accountNumber: '2222222222',
          counterpartyAccountNumber: '1111111111',
          type: 'TRANSFER',
          status: 'POSTED',
          createdAt: '2024-01-01T00:00:00.000Z',
          BANKING_GSI2PK: 'ACCOUNT#acc-321',
          BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
          transactionId: 'txn-123',
          description: 'Test transfer',
        },
      ];

      mockSend.mockResolvedValueOnce({
        Items: [headerData, ...postingData],
        Count: 3,
      });

      await repository.getTransactionById('txn-789');

      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-banking-table',
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: {
            ':pk': 'TXN#txn-789',
          },
        })
      );
    });

    it('should handle transaction without idempotency key', async () => {
      const headerData: TransactionHeaderItem = {
        PK: 'TXN#txn-123',
        SK: 'META',
        type: 'TRANSFER',
        status: 'COMPLETED',
        description: 'Test transfer',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const postingData: PostingItem[] = [
        {
          PK: 'TXN#txn-123',
          SK: 'POST#0',
          accountId: 'acc-123',
          amount: 2500,
          side: 'CREDIT',
          accountNumber: '1111111111',
          counterpartyAccountNumber: '2222222222',
          type: 'TRANSFER',
          status: 'POSTED',
          createdAt: '2024-01-01T00:00:00.000Z',
          BANKING_GSI2PK: 'ACCOUNT#acc-123',
          BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
          transactionId: 'txn-123',
          description: 'Test transfer',
        },
        {
          PK: 'TXN#txn-123',
          SK: 'POST#1',
          accountId: 'acc-321',
          amount: 2500,
          side: 'DEBIT',
          accountNumber: '2222222222',
          counterpartyAccountNumber: '1111111111',
          type: 'TRANSFER',
          status: 'POSTED',
          createdAt: '2024-01-01T00:00:00.000Z',
          BANKING_GSI2PK: 'ACCOUNT#acc-321',
          BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
          transactionId: 'txn-123',
          description: 'Test transfer',
        },
      ];

      mockSend.mockResolvedValueOnce({
        Items: [headerData, ...postingData],
        Count: 3,
      });

      const transaction = await repository.getTransactionById('txn-123');

      expect(transaction).toBeDefined();
      expect(transaction!.transactionIdempotencyKey).toBeUndefined();
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });

    it('should correctly map posting data', async () => {
      const headerData: TransactionHeaderItem = {
        PK: 'TXN#txn-123',
        SK: 'META',
        type: 'TRANSFER',
        status: 'POSTED',
        description: 'Test transfer',
        transactionId: 'txn-123',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const postingData: PostingItem[] = [
        {
          PK: 'TXN#txn-123',
          SK: 'POST#0',
          accountId: 'acc-123',
          amount: 2500,
          side: 'CREDIT',
          accountNumber: '1111111111',
          counterpartyAccountNumber: '2222222222',
          type: 'TRANSFER',
          status: 'POSTED',
          createdAt: '2024-01-01T00:00:00.000Z',
          BANKING_GSI2PK: 'ACCOUNT#acc-123',
          BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
          transactionId: 'txn-123',
          description: 'Test transfer',
        },
        {
          PK: 'TXN#txn-123',
          SK: 'POST#1',
          accountId: 'acc-321',
          amount: 2500,
          side: 'DEBIT',
          accountNumber: '2222222222',
          counterpartyAccountNumber: '1111111111',
          type: 'TRANSFER',
          status: 'POSTED',
          createdAt: '2024-01-01T00:00:00.000Z',
          BANKING_GSI2PK: 'ACCOUNT#acc-321',
          BANKING_GSI2SK: 'POST#2024-01-01T00:00:00.000Z',
          transactionId: 'txn-123',
          description: 'Test transfer',
        },
      ];

      mockSend.mockResolvedValueOnce({
        Items: [headerData, ...postingData],
        Count: 3,
      });

      const transaction = await repository.getTransactionById('txn-123');

      expect(transaction).toBeDefined();
      expect(transaction!.postings).toHaveLength(2);
      expect(transaction!.postings[0].accountId).toBe('acc-123');
      expect(transaction!.postings[0].amount.toCents()).toBe(2500);
      expect(transaction!.postings[0].side).toBe('CREDIT');
      expect(transaction!.postings[0].accountNumber).toBe('1111111111');
      expect(transaction!.postings[0].counterpartyAccountNumber).toBe(
        '2222222222'
      );
      expect(transaction!.postings[1].accountId).toBe('acc-321');
      expect(transaction!.postings[1].amount.toCents()).toBe(2500);
      expect(transaction!.postings[1].side).toBe('DEBIT');
      expect(transaction!.postings[1].accountNumber).toBe('2222222222');
      expect(transaction!.postings[1].counterpartyAccountNumber).toBe(
        '1111111111'
      );
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
    });
  });
});
