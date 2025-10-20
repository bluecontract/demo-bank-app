import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoBankingRepository } from './DynamoBankingRepository';
import { Account } from '../domain/entities/Account';
import { Transaction } from '../domain/entities/Transaction';
import { Money } from '../domain/valueObjects/Money';
import { Posting } from '../domain/valueObjects/Posting';

// Helper function to create test accounts with required properties
const createTestAccount = (
  overrides: Partial<ConstructorParameters<typeof Account>[0]> = {}
) => {
  return new Account({
    id: 'acc-test',
    accountNumber: '1234567890',
    name: 'Test Account',
    ownerUserId: 'user-test',
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date(),
    ledgerBalanceMinor: new Money(0),
    availableBalanceMinor: new Money(0),
    balanceVersion: 0,
    ...overrides,
  });
};

const TEST_CONFIG = {
  tableName: `demo-bank-app-banking-dynamo-repository-integration-test-${Date.now()}`,
  localstackEndpoint: 'http://localhost:4566',
  region: 'us-east-1',
};

let dynamoClient: DynamoDBClient;
let repository: DynamoBankingRepository;

async function setupTable() {
  await dynamoClient.send(
    new CreateTableCommand({
      TableName: TEST_CONFIG.tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI1PK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI1SK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI2PK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'BANKING_GSI1',
          KeySchema: [
            { AttributeName: 'BANKING_GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'BANKING_GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },

        {
          IndexName: 'BANKING_GSI2',
          KeySchema: [
            { AttributeName: 'BANKING_GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'BANKING_GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    })
  );
  // Wait for table to be active
  let tableReady = false;
  for (let i = 0; i < 10; i++) {
    try {
      const result = await dynamoClient.send(
        new DescribeTableCommand({ TableName: TEST_CONFIG.tableName })
      );
      if (result.Table?.TableStatus === 'ACTIVE') {
        tableReady = true;
        break;
      }
    } catch {
      console.log('Table not active yet, waiting...');
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!tableReady) throw new Error('DynamoDB table failed to become active');
}

async function cleanupTable() {
  await dynamoClient.send(
    new DeleteTableCommand({ TableName: TEST_CONFIG.tableName })
  );
}

describe('DynamoBankingRepository Integration', () => {
  beforeAll(async () => {
    dynamoClient = new DynamoDBClient({
      endpoint: TEST_CONFIG.localstackEndpoint,
      region: TEST_CONFIG.region,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await setupTable();
    repository = new DynamoBankingRepository({
      tableName: TEST_CONFIG.tableName,
      region: TEST_CONFIG.region,
      endpoint: TEST_CONFIG.localstackEndpoint,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
  });

  afterAll(async () => {
    await cleanupTable();
  });

  it('should save and retrieve an account', async () => {
    const account = createTestAccount({
      id: 'acc-1',
      accountNumber: '1234567890',
      name: 'Test Account 1',
      ownerUserId: 'user-1',
    });
    await repository.saveAccount(account);
    const loaded = await repository.getAccountById('acc-1');
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe('acc-1');
    expect(loaded!.accountNumber).toBe('1234567890');
  });

  it('should retrieve account with correct balance information', async () => {
    const account = createTestAccount({
      id: 'acc-balance-test',
      accountNumber: '5555555555',
      name: 'Balance Test Account',
      ownerUserId: 'user-balance',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date(),
      ledgerBalanceMinor: new Money(250000), // $2,500.00
      availableBalanceMinor: new Money(200000), // $2,000.00
      balanceVersion: 5,
    });

    await repository.saveAccount(account);
    const retrieved = await repository.getAccountById('acc-balance-test');

    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('acc-balance-test');
    expect(retrieved!.accountNumber).toBe('5555555555');
    expect(retrieved!.name).toBe('Balance Test Account');
    expect(retrieved!.ownerUserId).toBe('user-balance');
    expect(retrieved!.ledgerBalanceMinor.toCents()).toBe(250000);
    expect(retrieved!.availableBalanceMinor.toCents()).toBe(200000);
    expect(retrieved!.balanceVersion).toBe(5);
  });

  it('should return null for non-existent account', async () => {
    const loaded = await repository.getAccountById('does-not-exist');
    expect(loaded).toBeNull();
  });

  it('should save and retrieve by account number', async () => {
    const account = createTestAccount({
      id: 'acc-2',
      accountNumber: '2222222222',
      name: 'Test Account 2',
      ownerUserId: 'user-2',
    });
    await repository.saveAccount(account);
    const id = await repository.getAccountIdByNumber('2222222222');
    expect(id).toBe('acc-2');
  });

  it('should save and retrieve multiple accounts for a user', async () => {
    const account1 = createTestAccount({
      id: 'acc-3',
      accountNumber: '3333333333',
      name: 'Test Account 3',
      ownerUserId: 'user-3',
    });
    const account2 = createTestAccount({
      id: 'acc-4',
      accountNumber: '4444444444',
      name: 'Test Account 4',
      ownerUserId: 'user-3',
    });
    await repository.saveAccount(account1);
    await repository.saveAccount(account2);
    const accounts = await repository.getAccountsByUserId('user-3');
    expect(accounts.length).toBeGreaterThanOrEqual(2);
    const ids = accounts.map(a => a.id);
    expect(ids).toContain('acc-3');
    expect(ids).toContain('acc-4');
  });

  it('should save a transaction and update balances', async () => {
    const timestamp = Date.now().toString();
    const src = createTestAccount({
      id: `acc-5-${timestamp}`,
      accountNumber: `5555${timestamp.slice(-6)}`,
      name: 'Source Account',
      ownerUserId: 'user-5',
      ledgerBalanceMinor: new Money(10000),
      availableBalanceMinor: new Money(10000),
      balanceVersion: 1,
    });
    const dst = createTestAccount({
      id: `acc-6-${timestamp}`,
      accountNumber: `6666${timestamp.slice(-6)}`,
      name: 'Destination Account',
      ownerUserId: 'user-6',
      ledgerBalanceMinor: new Money(0),
      availableBalanceMinor: new Money(0),
      balanceVersion: 1,
    });
    await repository.saveAccount(src);
    await repository.saveAccount(dst);

    const debit = new Posting({
      accountId: src.id,
      amount: new Money(1000),
      side: 'DEBIT',
      accountNumber: src.accountNumber,
      counterpartyAccountNumber: dst.accountNumber,
    });
    const credit = new Posting({
      accountId: dst.id,
      amount: new Money(1000),
      side: 'CREDIT',
      accountNumber: dst.accountNumber,
      counterpartyAccountNumber: src.accountNumber,
    });
    src.applyPosting(debit);
    dst.applyPosting(credit);
    const txn = Transaction.create([debit, credit], {
      description: 'Test transfer',
      idempotencyKey: `txn-key-1-${timestamp}`,
    });
    await repository.saveTransactionWithAccounts(txn, [src, dst], {
      userId: 'user-5',
      idempotencyKey: `txn-key-1-${timestamp}`,
    });
    // Check balances
    const srcBalance = await repository.getAccountById(src.id);
    const dstBalance = await repository.getAccountById(dst.id);
    expect(srcBalance!.ledgerBalanceMinor.toCents()).toBe(9000);
    expect(dstBalance!.ledgerBalanceMinor.toCents()).toBe(1000);
    expect(srcBalance!.availableBalanceMinor.toCents()).toBe(9000);
    expect(dstBalance!.availableBalanceMinor.toCents()).toBe(1000);
  });

  describe('Complex Transaction Scenarios', () => {
    it('should handle multi-posting transaction (3+ accounts)', async () => {
      // Create three accounts for a split transaction with unique account numbers
      const timestamp = Date.now().toString();
      const source = createTestAccount({
        id: `acc-multi-1-${timestamp}`,
        accountNumber: `1111${timestamp.slice(-6)}`,
        name: 'Multi Source Account',
        ownerUserId: 'user-multi-1',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(10000),
        availableBalanceMinor: new Money(10000),
      });

      const dest1 = createTestAccount({
        id: `acc-multi-2-${timestamp}`,
        accountNumber: `2222${timestamp.slice(-6)}`,
        name: 'Multi Dest 1',
        ownerUserId: 'user-multi-2',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(0),
        availableBalanceMinor: new Money(0),
      });

      const dest2 = createTestAccount({
        id: `acc-multi-3-${timestamp}`,
        accountNumber: `3333${timestamp.slice(-6)}`,
        name: 'Multi Dest 2',
        ownerUserId: 'user-multi-3',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(0),
        availableBalanceMinor: new Money(0),
      });

      await repository.saveAccount(source);
      await repository.saveAccount(dest1);
      await repository.saveAccount(dest2);

      // Create split transaction: 1000 from source, 600 to dest1, 400 to dest2
      const debitPosting = new Posting({
        accountId: source.id,
        amount: new Money(1000),
        side: 'DEBIT',
        accountNumber: source.accountNumber,
        counterpartyAccountNumber: 'MULTIPLE',
      });

      const credit1Posting = new Posting({
        accountId: dest1.id,
        amount: new Money(600),
        side: 'CREDIT',
        accountNumber: dest1.accountNumber,
        counterpartyAccountNumber: source.accountNumber,
      });

      const credit2Posting = new Posting({
        accountId: dest2.id,
        amount: new Money(400),
        side: 'CREDIT',
        accountNumber: dest2.accountNumber,
        counterpartyAccountNumber: source.accountNumber,
      });

      source.applyPosting(debitPosting);
      dest1.applyPosting(credit1Posting);
      dest2.applyPosting(credit2Posting);

      const transaction = Transaction.create(
        [debitPosting, credit1Posting, credit2Posting],
        {
          description: 'Split transfer to multiple accounts',
          idempotencyKey: 'multi-posting-key-1',
        }
      );

      await repository.saveTransactionWithAccounts(
        transaction,
        [source, dest1, dest2],
        {
          userId: 'user-multi-1',
          idempotencyKey: 'multi-posting-key-1',
        }
      );

      // Verify balances
      const sourceBalance = await repository.getAccountById(source.id);
      const dest1Balance = await repository.getAccountById(dest1.id);
      const dest2Balance = await repository.getAccountById(dest2.id);

      expect(sourceBalance!.ledgerBalanceMinor.toCents()).toBe(9000); // 10000 - 1000
      expect(dest1Balance!.ledgerBalanceMinor.toCents()).toBe(600);
      expect(dest2Balance!.ledgerBalanceMinor.toCents()).toBe(400);

      // Verify transaction can be retrieved
      const savedTransaction = await repository.getTransactionById(
        transaction.id
      );
      expect(savedTransaction).toBeDefined();
      expect(savedTransaction!.postings).toHaveLength(3);
    });

    it('should handle large amount transactions near boundaries', async () => {
      const largeAccount1 = createTestAccount({
        id: 'acc-large-1',
        accountNumber: '7777777777',
        name: 'Large Account 1',
        ownerUserId: 'user-large-1',
        ledgerBalanceMinor: new Money(999999999), // Near max safe integer
        availableBalanceMinor: new Money(999999999),
      });

      const largeAccount2 = createTestAccount({
        id: 'acc-large-2',
        accountNumber: '8888888888',
        name: 'Large Account 2',
        ownerUserId: 'user-large-2',
        ledgerBalanceMinor: new Money(0),
        availableBalanceMinor: new Money(0),
      });

      await repository.saveAccount(largeAccount1);
      await repository.saveAccount(largeAccount2);

      const largeAmount = new Money(100000000); // 1 million dollars in cents

      const debit = new Posting({
        accountId: largeAccount1.id,
        amount: largeAmount,
        side: 'DEBIT',
        accountNumber: largeAccount1.accountNumber,
        counterpartyAccountNumber: largeAccount2.accountNumber,
      });

      const credit = new Posting({
        accountId: largeAccount2.id,
        amount: largeAmount,
        side: 'CREDIT',
        accountNumber: largeAccount2.accountNumber,
        counterpartyAccountNumber: largeAccount1.accountNumber,
      });

      largeAccount1.applyPosting(debit);
      largeAccount2.applyPosting(credit);

      const largeTransaction = Transaction.create([debit, credit], {
        description: 'Large amount transfer test',
        idempotencyKey: 'large-amount-key-1',
      });

      await repository.saveTransactionWithAccounts(
        largeTransaction,
        [largeAccount1, largeAccount2],
        {
          userId: 'user-large-1',
          idempotencyKey: 'large-amount-key-1',
        }
      );

      // Verify balances handled large amounts correctly
      const balance1 = await repository.getAccountById(largeAccount1.id);
      const balance2 = await repository.getAccountById(largeAccount2.id);

      expect(balance1!.ledgerBalanceMinor.toCents()).toBe(899999999); // 999999999 - 100000000
      expect(balance2!.ledgerBalanceMinor.toCents()).toBe(100000000);
    });

    it('should handle sequential transactions on same accounts', async () => {
      const account1 = createTestAccount({
        id: 'acc-seq-1',
        accountNumber: '1010101010',
        name: 'Sequential Test Account 1',
        ownerUserId: 'user-seq-1',
        ledgerBalanceMinor: new Money(10000),
        availableBalanceMinor: new Money(10000),
      });

      const account2 = createTestAccount({
        id: 'acc-seq-2',
        accountNumber: '2020202020',
        name: 'Sequential Test Account 2',
        ownerUserId: 'user-seq-2',
        ledgerBalanceMinor: new Money(5000),
        availableBalanceMinor: new Money(5000),
      });

      await repository.saveAccount(account1);
      await repository.saveAccount(account2);

      // Execute three sequential transactions
      for (let i = 1; i <= 3; i++) {
        // Load fresh account state for each transaction
        const freshAccount1 = await repository.getAccountById(account1.id);
        const freshAccount2 = await repository.getAccountById(account2.id);

        const amount = new Money(1000 * i); // Increasing amounts: 1000, 2000, 3000

        const debit = new Posting({
          accountId: freshAccount1!.id,
          amount,
          side: 'DEBIT',
          accountNumber: freshAccount1!.accountNumber,
          counterpartyAccountNumber: freshAccount2!.accountNumber,
        });

        const credit = new Posting({
          accountId: freshAccount2!.id,
          amount,
          side: 'CREDIT',
          accountNumber: freshAccount2!.accountNumber,
          counterpartyAccountNumber: freshAccount1!.accountNumber,
        });

        freshAccount1!.applyPosting(debit);
        freshAccount2!.applyPosting(credit);

        const transaction = Transaction.create([debit, credit], {
          description: `Sequential transfer ${i}`,
          idempotencyKey: `seq-key-${i}`,
        });

        await repository.saveTransactionWithAccounts(
          transaction,
          [freshAccount1!, freshAccount2!],
          {
            userId: 'user-seq-1',
            idempotencyKey: `seq-key-${i}`,
          }
        );
      }

      // Verify final balances after all transactions
      const finalBalance1 = await repository.getAccountById(account1.id);
      const finalBalance2 = await repository.getAccountById(account2.id);

      // Total debited from account1: 1000 + 2000 + 3000 = 6000
      expect(finalBalance1!.ledgerBalanceMinor.toCents()).toBe(4000); // 10000 - 6000
      expect(finalBalance2!.ledgerBalanceMinor.toCents()).toBe(11000); // 5000 + 6000

      // Verify all transactions can be retrieved
      const account1Transactions = await repository.getTransactionsByAccount(
        account1.id,
        { limit: 10 }
      );
      expect(account1Transactions.items).toHaveLength(3);
    });
  });

  describe('Concurrency Testing', () => {
    it('should handle simultaneous transactions on same account with optimistic locking', async () => {
      // Create source account with sufficient balance
      const sourceAccount = createTestAccount({
        id: 'acc-concurrent-1.1',
        accountNumber: '1111222233',
        name: 'Concurrent Source Account',
        ownerUserId: 'user-concurrent-1',
        ledgerBalanceMinor: new Money(100000), // $1000
        availableBalanceMinor: new Money(100000),
      });

      const destAccount1 = createTestAccount({
        id: 'acc-concurrent-2.1',
        accountNumber: '2222333344',
        name: 'Concurrent Dest 1',
        ownerUserId: 'user-concurrent-2',
        ledgerBalanceMinor: new Money(0),
        availableBalanceMinor: new Money(0),
      });

      const destAccount2 = createTestAccount({
        id: 'acc-concurrent-3',
        accountNumber: '3333444455',
        name: 'Concurrent Dest 2',
        ownerUserId: 'user-concurrent-3',
        ledgerBalanceMinor: new Money(0),
        availableBalanceMinor: new Money(0),
      });

      await repository.saveAccount(sourceAccount);
      await repository.saveAccount(destAccount1);
      await repository.saveAccount(destAccount2);

      // Create two simultaneous transactions from same source account
      const createTransaction = async (
        destId: string,
        destAccountNumber: string,
        amount: number,
        idempotencyKey: string
      ) => {
        // Load fresh account state
        const freshSource = await repository.getAccountById(sourceAccount.id);
        const freshDest = await repository.getAccountById(destId);

        const debitPosting = new Posting({
          accountId: freshSource!.id,
          amount: new Money(amount),
          side: 'DEBIT',
          accountNumber: freshSource!.accountNumber,
          counterpartyAccountNumber: destAccountNumber,
        });

        const creditPosting = new Posting({
          accountId: freshDest!.id,
          amount: new Money(amount),
          side: 'CREDIT',
          accountNumber: freshDest!.accountNumber,
          counterpartyAccountNumber: freshSource!.accountNumber,
        });

        freshSource!.applyPosting(debitPosting);
        freshDest!.applyPosting(creditPosting);

        const transaction = Transaction.create([debitPosting, creditPosting], {
          description: `Concurrent transfer ${amount}`,
          idempotencyKey,
        });

        return repository.saveTransactionWithAccounts(
          transaction,
          [freshSource!, freshDest!],
          {
            userId: 'user-concurrent-1',
            idempotencyKey,
          }
        );
      };

      // Execute transactions concurrently - one should succeed, one should fail due to optimistic locking
      const results = await Promise.allSettled([
        createTransaction(
          destAccount1.id,
          destAccount1.accountNumber,
          30000,
          'concurrent-key-1'
        ),
        createTransaction(
          destAccount2.id,
          destAccount2.accountNumber,
          40000,
          'concurrent-key-2'
        ),
      ]);

      // At least one should succeed (could be both if timing allows)
      const successCount = results.filter(r => r.status === 'fulfilled').length;

      expect(successCount).toBeGreaterThanOrEqual(1);

      // Check final balance integrity - should be consistent
      const finalSourceBalance = await repository.getAccountById(
        sourceAccount.id
      );
      const finalDest1Balance = await repository.getAccountById(
        destAccount1.id
      );
      const finalDest2Balance = await repository.getAccountById(
        destAccount2.id
      );

      // Total balance should be preserved
      const totalBalance =
        finalSourceBalance!.ledgerBalanceMinor.toCents() +
        finalDest1Balance!.ledgerBalanceMinor.toCents() +
        finalDest2Balance!.ledgerBalanceMinor.toCents();

      expect(totalBalance).toBe(100000); // Original amount preserved
    });

    it('should handle concurrent idempotency conflicts correctly', async () => {
      const account1 = createTestAccount({
        id: 'acc-idem-1',
        accountNumber: '5555666677',
        name: 'Idempotency Account 1',
        ownerUserId: 'user-idem-1',
        ledgerBalanceMinor: new Money(50000),
        availableBalanceMinor: new Money(50000),
      });

      const account2 = createTestAccount({
        id: 'acc-idem-2',
        accountNumber: '6666777788',
        name: 'Idempotency Account 2',
        ownerUserId: 'user-idem-2',
        ledgerBalanceMinor: new Money(10000),
        availableBalanceMinor: new Money(10000),
      });

      await repository.saveAccount(account1);
      await repository.saveAccount(account2);

      const sameIdempotencyKey = 'duplicate-concurrent-key';

      // Create identical transaction with same idempotency key
      const createDuplicateTransaction = async () => {
        const freshAccount1 = await repository.getAccountById(account1.id);
        const freshAccount2 = await repository.getAccountById(account2.id);

        const debitPosting = new Posting({
          accountId: freshAccount1!.id,
          amount: new Money(5000),
          side: 'DEBIT',
          accountNumber: freshAccount1!.accountNumber,
          counterpartyAccountNumber: freshAccount2!.accountNumber,
        });

        const creditPosting = new Posting({
          accountId: freshAccount2!.id,
          amount: new Money(5000),
          side: 'CREDIT',
          accountNumber: freshAccount2!.accountNumber,
          counterpartyAccountNumber: freshAccount1!.accountNumber,
        });

        freshAccount1!.applyPosting(debitPosting);
        freshAccount2!.applyPosting(creditPosting);

        const transaction = Transaction.create([debitPosting, creditPosting], {
          description: 'Duplicate idempotency test',
          idempotencyKey: sameIdempotencyKey,
        });

        return repository.saveTransactionWithAccounts(
          transaction,
          [freshAccount1!, freshAccount2!],
          {
            userId: 'user-idem-1',
            idempotencyKey: sameIdempotencyKey,
          }
        );
      };

      // Execute same transaction multiple times concurrently
      const results = await Promise.allSettled([
        createDuplicateTransaction(),
        createDuplicateTransaction(),
        createDuplicateTransaction(),
      ]);

      // All idempotent operations should succeed
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBe(3);

      // Verify only one transaction was actually applied
      const finalBalance1 = await repository.getAccountById(account1.id);
      const finalBalance2 = await repository.getAccountById(account2.id);

      // Balance should reflect only one transaction
      expect(finalBalance1!.ledgerBalanceMinor.toCents()).toBe(45000); // 50000 - 5000
      expect(finalBalance2!.ledgerBalanceMinor.toCents()).toBe(15000); // 10000 + 5000
    });

    it('should handle concurrent transactions with same account state (version competition)', async () => {
      const originalBalance1 = new Money(200000);
      const originalBalance2 = new Money(0);

      const concurrentAccount1 = createTestAccount({
        id: 'acc-concurrent-1.2',
        accountNumber: '7777888899',
        name: 'Concurrent Account 1',
        ownerUserId: 'user-concurrent-1',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: originalBalance1,
        availableBalanceMinor: originalBalance1,
      });

      const concurrentAccount2 = createTestAccount({
        id: 'acc-concurrent-2.2',
        accountNumber: '8888999900',
        name: 'Concurrent Account 2',
        ownerUserId: 'user-concurrent-2',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: originalBalance2,
        availableBalanceMinor: originalBalance2,
      });

      await repository.saveAccount(concurrentAccount1);
      await repository.saveAccount(concurrentAccount2);

      // Load accounts once - both transactions will compete with the same account state/version
      const account1Fresh = await repository.getAccountById(
        concurrentAccount1.id
      );
      const account2Fresh = await repository.getAccountById(
        concurrentAccount2.id
      );

      // Create two transactions that compete with the same account state
      const createCompetingTransaction = async (
        transactionId: string,
        amount: number
      ) => {
        // Clone accounts so each transaction has its own copy but with same version
        const account1Clone = createTestAccount({
          id: account1Fresh!.id,
          accountNumber: account1Fresh!.accountNumber,
          name: account1Fresh!.name,
          ownerUserId: account1Fresh!.ownerUserId,
          status: account1Fresh!.status,
          currency: account1Fresh!.currency,
          createdAt: account1Fresh!.createdAt,
          ledgerBalanceMinor: account1Fresh!.ledgerBalanceMinor,
          availableBalanceMinor: account1Fresh!.availableBalanceMinor,
          balanceVersion: account1Fresh!.balanceVersion, // Same version - this is key for optimistic locking test
        });

        const account2Clone = createTestAccount({
          id: account2Fresh!.id,
          accountNumber: account2Fresh!.accountNumber,
          name: account2Fresh!.name,
          ownerUserId: account2Fresh!.ownerUserId,
          status: account2Fresh!.status,
          currency: account2Fresh!.currency,
          createdAt: account2Fresh!.createdAt,
          ledgerBalanceMinor: account2Fresh!.ledgerBalanceMinor,
          availableBalanceMinor: account2Fresh!.availableBalanceMinor,
          balanceVersion: account2Fresh!.balanceVersion, // Same version - this is key for optimistic locking test
        });

        const debitPosting = new Posting({
          accountId: account1Clone.id,
          amount: new Money(amount),
          side: 'DEBIT',
          accountNumber: account1Clone.accountNumber,
          counterpartyAccountNumber: account2Clone.accountNumber,
        });

        const creditPosting = new Posting({
          accountId: account2Clone.id,
          amount: new Money(amount),
          side: 'CREDIT',
          accountNumber: account2Clone.accountNumber,
          counterpartyAccountNumber: account1Clone.accountNumber,
        });

        account1Clone.applyPosting(debitPosting);
        account2Clone.applyPosting(creditPosting);

        const transaction = Transaction.create([debitPosting, creditPosting], {
          description: `Competing transaction ${transactionId}`,
          idempotencyKey: `competing-key-${transactionId}`,
        });

        try {
          await repository.saveTransactionWithAccounts(
            transaction,
            [account1Clone, account2Clone],
            {
              userId: 'user-concurrent-1',
              idempotencyKey: `competing-key-${transactionId}`,
            }
          );
          return { success: true, transactionId, amount };
        } catch (error) {
          return { success: false, error, transactionId, amount };
        }
      };

      // Execute two transactions in parallel - they should compete if truly parallel
      const promises = [
        createCompetingTransaction('txn-1', 10000), // $100
        createCompetingTransaction('txn-2', 15000), // $150
      ];
      const results = await Promise.allSettled(promises);

      const actualResults = results.map(r =>
        r.status === 'fulfilled' ? r.value : { success: false, error: r.reason }
      );

      const successCount = actualResults.filter(r => r.success).length;
      const failureCount = actualResults.filter(r => !r.success).length;

      // Verify balance consistency regardless of outcome
      const finalBalance1 = await repository.getAccountById(
        concurrentAccount1.id
      );
      const finalBalance2 = await repository.getAccountById(
        concurrentAccount2.id
      );

      // Total balance should always be preserved
      const totalBalance =
        finalBalance1!.ledgerBalanceMinor.toCents() +
        finalBalance2!.ledgerBalanceMinor.toCents();
      expect(totalBalance).toBe(200000);

      // Get current balances for assertions
      const account1Balance = finalBalance1!.ledgerBalanceMinor.toCents();
      const account2Balance = finalBalance2!.ledgerBalanceMinor.toCents();

      // With optimistic locking and same starting versions, exactly one transaction should succeed
      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Verify double-entry bookkeeping: account1 debits = account2 credits
      const account1Change = originalBalance1.toCents() - account1Balance; // Amount debited from account1
      const account2Change = account2Balance - originalBalance2.toCents(); // Amount credited to account2

      expect(account1Change).toBe(account2Change); // Double-entry bookkeeping
      expect(account1Change).toBeGreaterThan(0); // One transaction succeeded

      // Verify the change matches one of our transaction amounts (but not both)
      const possibleAmounts = [10000, 15000]; // Individual transactions only
      expect(possibleAmounts).toContain(account1Change);

      // Verify the failed transaction was due to optimistic locking
      const failedResult = actualResults.find(r => !r.success);
      expect(failedResult).toBeDefined();
      expect(failedResult!.error).toBeDefined();
    });

    it('should maintain data consistency during concurrent account creation', async () => {
      const userId = 'user-concurrent-create';

      // Create multiple accounts concurrently for same user
      const createAccountConcurrently = async (index: number) => {
        const account = createTestAccount({
          id: `acc-create-${index}`,
          accountNumber: `9999${index.toString().padStart(6, '0')}`,
          name: `Concurrent Account ${index}`,
          ownerUserId: userId,
          status: 'ACTIVE',
          currency: 'USD',
          createdAt: new Date(),
          ledgerBalanceMinor: new Money(1000 * index),
          availableBalanceMinor: new Money(1000 * index),
        });

        return repository.saveAccount(account);
      };

      // Create 5 accounts concurrently
      const createPromises = Array.from({ length: 5 }, (_, i) =>
        createAccountConcurrently(i)
      );
      const results = await Promise.allSettled(createPromises);

      // All should succeed (no conflicts expected for different accounts)
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBe(5);

      // Verify all accounts can be retrieved
      const userAccounts = await repository.getAccountsByUserId(userId);
      expect(userAccounts.length).toBeGreaterThanOrEqual(5);

      // Verify each account has correct balance
      for (let i = 0; i < 5; i++) {
        const accountId = `acc-create-${i}`;
        const balance = await repository.getAccountById(accountId);
        expect(balance!.ledgerBalanceMinor.toCents()).toBe(1000 * i);
      }
    });

    it('should prevent duplicate account numbers through reservation system', async () => {
      const timestamp = Date.now().toString();
      const duplicateAccountNumber = `5555${timestamp.slice(-6)}`;

      // Create first account
      const account1 = createTestAccount({
        id: `acc-duplicate-1-${timestamp}`,
        accountNumber: duplicateAccountNumber,
        name: 'First Account',
        ownerUserId: 'user-duplicate-1',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(1000),
        availableBalanceMinor: new Money(1000),
      });

      await repository.saveAccount(account1);

      // Try to create second account with same account number
      const account2 = createTestAccount({
        id: `acc-duplicate-2-${timestamp}`,
        accountNumber: duplicateAccountNumber, // Same account number!
        name: 'Second Account',
        ownerUserId: 'user-duplicate-2',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(2000),
        availableBalanceMinor: new Money(2000),
      });

      // This should fail due to account number reservation conflict
      await expect(repository.saveAccount(account2)).rejects.toThrow();

      // Verify first account still exists and is retrievable
      const retrievedAccount = await repository.getAccountById(account1.id);
      expect(retrievedAccount).toBeDefined();
      expect(retrievedAccount!.accountNumber).toBe(duplicateAccountNumber);

      // Verify account number lookup still works for first account
      const accountIdByNumber = await repository.getAccountIdByNumber(
        duplicateAccountNumber
      );
      expect(accountIdByNumber).toBe(account1.id);

      // Verify second account was not created
      const notCreatedAccount = await repository.getAccountById(account2.id);
      expect(notCreatedAccount).toBeNull();
    });
  });

  describe('Error and Recovery Testing', () => {
    it('should handle not found account gracefully', async () => {
      // Test getAccountById with non-existent account
      const nonExistentAccount = await repository.getAccountById(
        'non-existent-acc'
      );
      expect(nonExistentAccount).toBeNull();

      // Test getAccountIdByNumber with non-existent account number
      const nonExistentAccountId = await repository.getAccountIdByNumber(
        '9999999999'
      );
      expect(nonExistentAccountId).toBeNull();

      // Test getAccountById with non-existent account - should throw
      await expect(
        repository.getAccountById('non-existent-acc')
      ).resolves.toBeNull();

      // Test getAccountById with non-existent account
      const nonExistentBalance = await repository.getAccountById(
        'non-existent-acc'
      );
      expect(nonExistentBalance).toBeNull();

      // Test getTransactionById with non-existent transaction
      const nonExistentTxn = await repository.getTransactionById(
        'non-existent-txn'
      );
      expect(nonExistentTxn).toBeNull();
    });

    it('should handle optimistic locking conflicts during balance updates', async () => {
      const lockingAccount = createTestAccount({
        id: 'acc-locking-1',
        accountNumber: '4444000001',
        name: 'Locking Test Account',
        ownerUserId: 'user-locking-1',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(50000),
        availableBalanceMinor: new Money(50000),
      });

      const targetAccount = createTestAccount({
        id: 'acc-locking-2',
        accountNumber: '5555000001',
        name: 'Target Account',
        ownerUserId: 'user-locking-2',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(0),
        availableBalanceMinor: new Money(0),
      });

      await repository.saveAccount(lockingAccount);
      await repository.saveAccount(targetAccount);

      // Simulate optimistic locking by modifying the account version manually
      // Load account and create valid transaction
      const account1 = await repository.getAccountById(lockingAccount.id);
      const account2 = await repository.getAccountById(targetAccount.id);

      const debitPosting = new Posting({
        accountId: account1!.id,
        amount: new Money(1000),
        side: 'DEBIT',
        accountNumber: account1!.accountNumber,
        counterpartyAccountNumber: account2!.accountNumber,
      });

      const creditPosting = new Posting({
        accountId: account2!.id,
        amount: new Money(1000),
        side: 'CREDIT',
        accountNumber: account2!.accountNumber,
        counterpartyAccountNumber: account1!.accountNumber,
      });

      account1!.applyPosting(debitPosting);
      account2!.applyPosting(creditPosting);

      const transaction = Transaction.create([debitPosting, creditPosting], {
        description: 'Locking test transaction',
        idempotencyKey: 'locking-test-key-1',
      });

      // Artificially modify the balance version to simulate concurrent modification
      // This should cause a conditional check failure in DynamoDB
      (account1 as any).balanceVersion = 999; // Wrong version

      // This should fail due to optimistic locking conflict
      await expect(
        repository.saveTransactionWithAccounts(
          transaction,
          [account1!, account2!],
          {
            userId: 'user-locking-1',
            idempotencyKey: 'locking-test-key-1',
          }
        )
      ).rejects.toThrow();

      // Verify original balances are unchanged
      const originalBalance1 = await repository.getAccountById(
        lockingAccount.id
      );
      const originalBalance2 = await repository.getAccountById(
        targetAccount.id
      );

      expect(originalBalance1!.ledgerBalanceMinor.toCents()).toBe(50000);
      expect(originalBalance2!.ledgerBalanceMinor.toCents()).toBe(0);
    });

    it('should handle empty query results gracefully', async () => {
      const emptyUserId = 'user-with-no-accounts';
      const emptyAccountId = 'acc-with-no-transactions';

      // Test getAccountsByUserId with user who has no accounts
      const emptyUserAccounts = await repository.getAccountsByUserId(
        emptyUserId
      );
      expect(emptyUserAccounts).toHaveLength(0);

      // Create account but don't add any transactions
      const emptyTxnAccount = createTestAccount({
        id: emptyAccountId,
        accountNumber: '8888000001',
        name: 'Empty Transaction Account',
        ownerUserId: 'user-empty-txn',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(1000),
        availableBalanceMinor: new Money(1000),
      });

      await repository.saveAccount(emptyTxnAccount);

      // Test getTransactionsByAccount with account that has no transactions
      const emptyTransactions = await repository.getTransactionsByAccount(
        emptyAccountId
      );
      expect(emptyTransactions.items).toHaveLength(0);
      expect(emptyTransactions.hasMore).toBe(false);
      expect(emptyTransactions.nextToken).toBeUndefined();
    });
  });

  describe('Data Consistency Validation', () => {
    it('should maintain ACID properties during transaction processing', async () => {
      const account1 = createTestAccount({
        id: 'acc-acid-1',
        accountNumber: '1111000010',
        name: 'ACID Test Account 1',
        ownerUserId: 'user-acid-1',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(50000),
        availableBalanceMinor: new Money(50000),
      });

      const account2 = createTestAccount({
        id: 'acc-acid-2',
        accountNumber: '2222000010',
        name: 'ACID Test Account 2',
        ownerUserId: 'user-acid-2',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(25000),
        availableBalanceMinor: new Money(25000),
      });

      await repository.saveAccount(account1);
      await repository.saveAccount(account2);

      const initialTotalBalance = 50000 + 25000; // 75000

      // Execute transaction and verify atomicity
      const freshAccount1 = await repository.getAccountById(account1.id);
      const freshAccount2 = await repository.getAccountById(account2.id);

      const transferAmount = new Money(10000);

      const debitPosting = new Posting({
        accountId: freshAccount1!.id,
        amount: transferAmount,
        side: 'DEBIT',
        accountNumber: freshAccount1!.accountNumber,
        counterpartyAccountNumber: freshAccount2!.accountNumber,
      });

      const creditPosting = new Posting({
        accountId: freshAccount2!.id,
        amount: transferAmount,
        side: 'CREDIT',
        accountNumber: freshAccount2!.accountNumber,
        counterpartyAccountNumber: freshAccount1!.accountNumber,
      });

      freshAccount1!.applyPosting(debitPosting);
      freshAccount2!.applyPosting(creditPosting);

      const transaction = Transaction.create([debitPosting, creditPosting], {
        description: 'ACID test transaction',
        idempotencyKey: 'acid-test-key-1',
      });

      await repository.saveTransactionWithAccounts(
        transaction,
        [freshAccount1!, freshAccount2!],
        {
          userId: 'user-acid-1',
          idempotencyKey: 'acid-test-key-1',
        }
      );

      // Verify Consistency: Total balance preserved (Conservation of money)
      const finalBalance1 = await repository.getAccountById(account1.id);
      const finalBalance2 = await repository.getAccountById(account2.id);
      const finalTotalBalance =
        finalBalance1!.ledgerBalanceMinor.toCents() +
        finalBalance2!.ledgerBalanceMinor.toCents();

      expect(finalTotalBalance).toBe(initialTotalBalance);

      // Verify Atomicity: Transaction either fully succeeded or fully failed
      const savedTransaction = await repository.getTransactionById(
        transaction.id
      );
      expect(savedTransaction).toBeDefined();
      expect(savedTransaction!.postings).toHaveLength(2);

      // Verify balances changed consistently
      expect(finalBalance1!.ledgerBalanceMinor.toCents()).toBe(40000); // 50000 - 10000
      expect(finalBalance2!.ledgerBalanceMinor.toCents()).toBe(35000); // 25000 + 10000

      // Verify Isolation: No partial states visible
      expect(finalBalance1!.ledgerBalanceMinor.toCents()).toBe(
        finalBalance1!.availableBalanceMinor.toCents()
      );
      expect(finalBalance2!.ledgerBalanceMinor.toCents()).toBe(
        finalBalance2!.availableBalanceMinor.toCents()
      );
    });

    it('should maintain double-entry bookkeeping integrity', async () => {
      const accounts = [];

      // Create 5 test accounts for complex transaction validation
      for (let i = 1; i <= 5; i++) {
        const account = createTestAccount({
          id: `acc-debit-${i}`,
          accountNumber: `${i}000000010`,
          name: `Double Entry Account ${i}`,
          ownerUserId: `user-debit-${i}`,
          status: 'ACTIVE',
          currency: 'USD',
          createdAt: new Date(),
          ledgerBalanceMinor: new Money(10000 * i), // Different starting balances
          availableBalanceMinor: new Money(10000 * i),
        });

        await repository.saveAccount(account);
        accounts.push(account);
      }

      // Calculate initial total balance across all accounts
      const initialBalances = await Promise.all(
        accounts.map(acc => repository.getAccountById(acc.id))
      );
      const initialTotal = initialBalances.reduce(
        (sum, balance) => sum + balance!.ledgerBalanceMinor.toCents(),
        0
      );

      // Execute multiple transactions to test double-entry integrity
      const transactions = [];

      // Transaction 1: Transfer from account 1 to account 2
      const freshAcc1 = await repository.getAccountById(accounts[0].id);
      const freshAcc2 = await repository.getAccountById(accounts[1].id);

      const debit1 = new Posting({
        accountId: freshAcc1!.id,
        amount: new Money(5000),
        side: 'DEBIT',
        accountNumber: freshAcc1!.accountNumber,
        counterpartyAccountNumber: freshAcc2!.accountNumber,
      });

      const credit1 = new Posting({
        accountId: freshAcc2!.id,
        amount: new Money(5000),
        side: 'CREDIT',
        accountNumber: freshAcc2!.accountNumber,
        counterpartyAccountNumber: freshAcc1!.accountNumber,
      });

      freshAcc1!.applyPosting(debit1);
      freshAcc2!.applyPosting(credit1);

      const txn1 = Transaction.create([debit1, credit1], {
        description: 'Double entry test 1',
        idempotencyKey: 'double-entry-1',
      });

      await repository.saveTransactionWithAccounts(
        txn1,
        [freshAcc1!, freshAcc2!],
        {
          userId: 'user-debit-1',
          idempotencyKey: 'double-entry-1',
        }
      );

      transactions.push(txn1);

      // Transaction 2: Transfer from account 3 to account 4
      const freshAcc3 = await repository.getAccountById(accounts[2].id);
      const freshAcc4 = await repository.getAccountById(accounts[3].id);

      const debit2 = new Posting({
        accountId: freshAcc3!.id,
        amount: new Money(7500),
        side: 'DEBIT',
        accountNumber: freshAcc3!.accountNumber,
        counterpartyAccountNumber: freshAcc4!.accountNumber,
      });

      const credit2 = new Posting({
        accountId: freshAcc4!.id,
        amount: new Money(7500),
        side: 'CREDIT',
        accountNumber: freshAcc4!.accountNumber,
        counterpartyAccountNumber: freshAcc3!.accountNumber,
      });

      freshAcc3!.applyPosting(debit2);
      freshAcc4!.applyPosting(credit2);

      const txn2 = Transaction.create([debit2, credit2], {
        description: 'Double entry test 2',
        idempotencyKey: 'double-entry-2',
      });

      await repository.saveTransactionWithAccounts(
        txn2,
        [freshAcc3!, freshAcc4!],
        {
          userId: 'user-debit-3',
          idempotencyKey: 'double-entry-2',
        }
      );

      transactions.push(txn2);

      // Verify double-entry bookkeeping: Total balance unchanged
      const finalBalances = await Promise.all(
        accounts.map(acc => repository.getAccountById(acc.id))
      );
      const finalTotal = finalBalances.reduce(
        (sum, balance) => sum + balance!.ledgerBalanceMinor.toCents(),
        0
      );

      expect(finalTotal).toBe(initialTotal);

      // Verify each transaction is internally balanced
      for (const transaction of transactions) {
        const savedTxn = await repository.getTransactionById(transaction.id);
        expect(savedTxn).toBeDefined();

        let totalDebits = 0;
        let totalCredits = 0;

        for (const posting of savedTxn!.postings) {
          if (posting.side === 'DEBIT') {
            totalDebits += posting.amount.toCents();
          } else {
            totalCredits += posting.amount.toCents();
          }
        }

        expect(totalDebits).toBe(totalCredits); // Each transaction must be balanced
      }
    });

    it('should maintain referential integrity between transactions and accounts', async () => {
      const refAccount1 = createTestAccount({
        id: 'acc-ref-1',
        accountNumber: '5555000010',
        name: 'Referential Account 1',
        ownerUserId: 'user-ref-1',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(30000),
        availableBalanceMinor: new Money(30000),
      });

      const refAccount2 = createTestAccount({
        id: 'acc-ref-2',
        accountNumber: '6666000010',
        name: 'Referential Account 2',
        ownerUserId: 'user-ref-2',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(15000),
        availableBalanceMinor: new Money(15000),
      });

      await repository.saveAccount(refAccount1);
      await repository.saveAccount(refAccount2);

      // Create transaction between accounts
      const freshRefAccount1 = await repository.getAccountById(refAccount1.id);
      const freshRefAccount2 = await repository.getAccountById(refAccount2.id);

      const debitPosting = new Posting({
        accountId: freshRefAccount1!.id,
        amount: new Money(8000),
        side: 'DEBIT',
        accountNumber: freshRefAccount1!.accountNumber,
        counterpartyAccountNumber: freshRefAccount2!.accountNumber,
      });

      const creditPosting = new Posting({
        accountId: freshRefAccount2!.id,
        amount: new Money(8000),
        side: 'CREDIT',
        accountNumber: freshRefAccount2!.accountNumber,
        counterpartyAccountNumber: freshRefAccount1!.accountNumber,
      });

      freshRefAccount1!.applyPosting(debitPosting);
      freshRefAccount2!.applyPosting(creditPosting);

      const refTransaction = Transaction.create([debitPosting, creditPosting], {
        description: 'Referential integrity test',
        idempotencyKey: 'referential-key-1',
      });

      await repository.saveTransactionWithAccounts(
        refTransaction,
        [freshRefAccount1!, freshRefAccount2!],
        {
          userId: 'user-ref-1',
          idempotencyKey: 'referential-key-1',
        }
      );

      // Verify referential integrity: Transaction references valid accounts
      const savedTransaction = await repository.getTransactionById(
        refTransaction.id
      );
      expect(savedTransaction).toBeDefined();

      for (const posting of savedTransaction!.postings) {
        // Each posting should reference a valid account
        const referencedAccount = await repository.getAccountById(
          posting.accountId
        );
        expect(referencedAccount).toBeDefined();
        expect(referencedAccount!.accountNumber).toBe(posting.accountNumber);
      }

      // Verify bidirectional consistency: Accounts show correct transactions
      const account1Transactions = await repository.getTransactionsByAccount(
        refAccount1.id
      );
      const account2Transactions = await repository.getTransactionsByAccount(
        refAccount2.id
      );

      expect(account1Transactions.items).toHaveLength(1);
      expect(account2Transactions.items).toHaveLength(1);
      expect(account1Transactions.items[0].transactionId).toBe(
        refTransaction.id
      );
      expect(account2Transactions.items[0].transactionId).toBe(
        refTransaction.id
      );

      // Verify account balances reflect transaction impact
      const finalBalance1 = await repository.getAccountById(refAccount1.id);
      const finalBalance2 = await repository.getAccountById(refAccount2.id);

      expect(finalBalance1!.ledgerBalanceMinor.toCents()).toBe(22000); // 30000 - 8000
      expect(finalBalance2!.ledgerBalanceMinor.toCents()).toBe(23000); // 15000 + 8000
    });

    it('should maintain data consistency under concurrent modifications', async () => {
      const concAccount1 = createTestAccount({
        id: 'acc-conc-consistency-1',
        accountNumber: '7777000010',
        name: 'Concurrent Consistency Account 1',
        ownerUserId: 'user-conc-consistency-1',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(100000),
        availableBalanceMinor: new Money(100000),
      });

      const concAccount2 = createTestAccount({
        id: 'acc-conc-consistency-2',
        accountNumber: '8888000010',
        name: 'Concurrent Consistency Account 2',
        ownerUserId: 'user-conc-consistency-2',
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: new Date(),
        ledgerBalanceMinor: new Money(50000),
        availableBalanceMinor: new Money(50000),
      });

      await repository.saveAccount(concAccount1);
      await repository.saveAccount(concAccount2);

      const initialTotal = 100000 + 50000; // 150000

      // Execute multiple concurrent operations
      const operations = [];

      for (let i = 1; i <= 3; i++) {
        const operation = async () => {
          const freshAcc1 = await repository.getAccountById(concAccount1.id);
          const freshAcc2 = await repository.getAccountById(concAccount2.id);

          const amount = new Money(1000 * i); // Different amounts

          const debitPosting = new Posting({
            accountId: freshAcc1!.id,
            amount,
            side: 'DEBIT',
            accountNumber: freshAcc1!.accountNumber,
            counterpartyAccountNumber: freshAcc2!.accountNumber,
          });

          const creditPosting = new Posting({
            accountId: freshAcc2!.id,
            amount,
            side: 'CREDIT',
            accountNumber: freshAcc2!.accountNumber,
            counterpartyAccountNumber: freshAcc1!.accountNumber,
          });

          freshAcc1!.applyPosting(debitPosting);
          freshAcc2!.applyPosting(creditPosting);

          const transaction = Transaction.create(
            [debitPosting, creditPosting],
            {
              description: `Concurrent consistency test ${i}`,
              idempotencyKey: `concurrent-consistency-${i}`,
            }
          );

          return repository.saveTransactionWithAccounts(
            transaction,
            [freshAcc1!, freshAcc2!],
            {
              userId: 'user-conc-consistency-1',
              idempotencyKey: `concurrent-consistency-${i}`,
            }
          );
        };

        operations.push(operation);
      }

      // Execute operations concurrently - some may fail due to optimistic locking
      const results = await Promise.allSettled(operations.map(op => op()));

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      // Verify data consistency regardless of concurrent execution results
      const finalBalance1 = await repository.getAccountById(concAccount1.id);
      const finalBalance2 = await repository.getAccountById(concAccount2.id);
      const finalTotal =
        finalBalance1!.ledgerBalanceMinor.toCents() +
        finalBalance2!.ledgerBalanceMinor.toCents();

      // Total balance must be preserved (money conservation)
      expect(finalTotal).toBe(initialTotal);

      // Verify all successful transactions are properly recorded
      const account1Txns = await repository.getTransactionsByAccount(
        concAccount1.id
      );
      const account2Txns = await repository.getTransactionsByAccount(
        concAccount2.id
      );

      expect(account1Txns.items.length).toBe(account2Txns.items.length);
      expect(account1Txns.items.length).toBe(successCount);

      // Verify transaction IDs match between accounts
      const account1TxnIds = account1Txns.items
        .map(t => t.transactionId)
        .sort();
      const account2TxnIds = account2Txns.items
        .map(t => t.transactionId)
        .sort();
      expect(account1TxnIds).toEqual(account2TxnIds);
    });
  });
});
