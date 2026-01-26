import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoUserRepository } from './DynamoUserRepository';
import { User } from '../domain/entities/User';
import { UserAlreadyExistsError } from './errors';
import { randomUUID } from 'crypto';

const TEST_CONFIG = {
  tableName: `demo-bank-app-auth-dynamo-user-repository-integration-test-${Date.now()}`,
  localstackEndpoint: 'http://localhost:4566',
  region: 'us-east-1',
  testUserTtlSeconds: 600, // 10 minutes
};

let dynamoClient: DynamoDBClient;
let repository: DynamoUserRepository;

async function setupTable() {
  await dynamoClient.send(
    new CreateTableCommand({
      TableName: TEST_CONFIG.tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'AUTH_GSI1PK', AttributeType: 'S' },
        { AttributeName: 'AUTH_GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'AUTH_GSI1',
          KeySchema: [
            { AttributeName: 'AUTH_GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'AUTH_GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    })
  );

  // Wait for table to be active
  let tableReady = false;
  while (!tableReady) {
    try {
      const result = await dynamoClient.send(
        new DescribeTableCommand({ TableName: TEST_CONFIG.tableName })
      );
      tableReady = result.Table?.TableStatus === 'ACTIVE';
      if (!tableReady) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function cleanupTable() {
  try {
    await dynamoClient.send(
      new DeleteTableCommand({ TableName: TEST_CONFIG.tableName })
    );
    // eslint-disable-next-line no-empty
  } catch {}
}

describe('DynamoUserRepository Integration', () => {
  beforeAll(async () => {
    dynamoClient = new DynamoDBClient({
      endpoint: TEST_CONFIG.localstackEndpoint,
      region: TEST_CONFIG.region,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await setupTable();
    repository = new DynamoUserRepository({
      tableName: TEST_CONFIG.tableName,
      region: TEST_CONFIG.region,
      testUserTtlSeconds: TEST_CONFIG.testUserTtlSeconds,
      endpoint: TEST_CONFIG.localstackEndpoint,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
  });

  afterAll(async () => {
    await cleanupTable();
  });

  describe('save user', () => {
    it('should save and retrieve a regular user', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        email: 'john.doe@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });

      // When
      const savedUser = await repository.save(user);

      // Then
      expect(savedUser.id).toBe(user.id);
      expect(savedUser.email).toBe(user.email);
      expect(savedUser.isTest).toBe(false);
      expect(savedUser.marketingEmailsOptIn).toBe(true);

      // Verify by retrieving
      const retrievedUser = await repository.findById(user.id);
      expect(retrievedUser).toBeDefined();
      expect(retrievedUser!.id).toBe(user.id);
      expect(retrievedUser!.email).toBe(user.email);
      expect(retrievedUser!.isTest).toBe(false);
      expect(retrievedUser!.marketingEmailsOptIn).toBe(true);
    });

    it('should save and retrieve a merchant user with merchantId', async () => {
      const user = new User({
        id: randomUUID(),
        email: 'merchant.integration@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
        merchantId: 'merchant-integration',
      });

      const savedUser = await repository.save(user);

      expect(savedUser.merchantId).toBe('merchant-integration');

      const retrievedUser = await repository.findById(user.id);
      expect(retrievedUser?.merchantId).toBe('merchant-integration');
    });

    it('should save and retrieve a test user with TTL', async () => {
      // Given
      const testUser = new User({
        id: randomUUID(),
        email: 'test.user@example.com',
        isTest: true,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: false,
      });

      // When
      const savedUser = await repository.save(testUser);

      // Then
      expect(savedUser.id).toBe(testUser.id);
      expect(savedUser.email).toBe(testUser.email);
      expect(savedUser.isTest).toBe(true);
      expect(savedUser.marketingEmailsOptIn).toBe(false);

      // Verify by retrieving
      const retrievedUser = await repository.findById(testUser.id);
      expect(retrievedUser).toBeDefined();
      expect(retrievedUser!.id).toBe(testUser.id);
      expect(retrievedUser!.email).toBe(testUser.email);
      expect(retrievedUser!.isTest).toBe(true);
      expect(retrievedUser!.marketingEmailsOptIn).toBe(false);
    });

    it('should throw UserAlreadyExistsError when saving user with duplicate name', async () => {
      // Given
      const user1 = new User({
        id: randomUUID(),
        email: 'duplicate-user@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });
      const user2 = new User({
        id: randomUUID(),
        email: 'duplicate-user@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });

      // When
      await repository.save(user1);

      // Then
      await expect(repository.save(user2)).rejects.toThrow(
        UserAlreadyExistsError
      );
    });
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        email: 'find-by-id-user@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });
      await repository.save(user);

      // When
      const foundUser = await repository.findById(user.id);

      // Then
      expect(foundUser).toBeDefined();
      expect(foundUser!.id).toBe(user.id);
      expect(foundUser!.email).toBe(user.email);
      expect(foundUser!.isTest).toBe(false);
      expect(foundUser!.marketingEmailsOptIn).toBe(true);
    });

    it('should return null when user not found', async () => {
      // Given
      const nonExistentId = 'non-existent-user-id';

      // When
      const foundUser = await repository.findById(nonExistentId as any);

      // Then
      expect(foundUser).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should return user when found by email', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        email: 'find-by-email-user@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });
      await repository.save(user);

      // When
      const foundUser = await repository.findByEmail(user.email);

      // Then
      expect(foundUser).toBeDefined();
      expect(foundUser!.id).toBe(user.id);
      expect(foundUser!.email).toBe(user.email);
      expect(foundUser!.isTest).toBe(false);
    });

    it('should return null when user not found by email', async () => {
      // Given
      const nonExistentEmail = 'non-existent-user@example.com';

      // When
      const foundUser = await repository.findByEmail(nonExistentEmail);

      // Then
      expect(foundUser).toBeNull();
    });
  });

  describe('data integrity', () => {
    it('should maintain referential integrity between email and user records', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        email: 'integrity-test-user@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });

      // When
      await repository.save(user);

      // Then
      const userById = await repository.findById(user.id);
      const userByEmail = await repository.findByEmail(user.email);

      expect(userById).toBeDefined();
      expect(userByEmail).toBeDefined();
      expect(userById!.id).toBe(userByEmail!.id);
      expect(userById!.email).toBe(userByEmail!.email);
      expect(userById!.createdAt).toEqual(userByEmail!.createdAt);
      expect(userById!.isTest).toBe(userByEmail!.isTest);
      expect(userById!.marketingEmailsOptIn).toBe(
        userByEmail!.marketingEmailsOptIn
      );
    });

    it('should handle concurrent user creation attempts gracefully', async () => {
      // Given
      const emailAddress = `concurrent-${Date.now()}@example.com`;
      const user1 = new User({
        id: randomUUID(),
        email: emailAddress,
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });
      const user2 = new User({
        id: randomUUID(),
        email: emailAddress,
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });

      // When
      const results = await Promise.allSettled([
        repository.save(user1),
        repository.save(user2),
      ]);

      // Then
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failureCount = results.filter(r => r.status === 'rejected').length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Verify the failed attempt threw UserAlreadyExistsError
      const failedResult = results.find(
        r => r.status === 'rejected'
      ) as PromiseRejectedResult;
      expect(failedResult.reason).toBeInstanceOf(UserAlreadyExistsError);
    });
  });

  describe('error scenarios', () => {
    it('should handle DynamoDB connection errors gracefully', async () => {
      // Given
      const invalidRepository = new DynamoUserRepository({
        tableName: 'non-existent-table',
        region: TEST_CONFIG.region,
        testUserTtlSeconds: TEST_CONFIG.testUserTtlSeconds,
        endpoint: TEST_CONFIG.localstackEndpoint,
      });

      const user = new User({
        id: randomUUID(),
        email: 'error-test-user@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });

      // When & Then
      await expect(invalidRepository.save(user)).rejects.toThrow();
    });
  });
});
