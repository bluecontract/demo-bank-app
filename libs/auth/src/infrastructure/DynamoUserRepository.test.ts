import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DynamoUserRepository } from './DynamoUserRepository';
import { User } from '../domain/entities/User';
import { UserAlreadyExistsError, AuthRepositoryError } from './errors';
import { randomUUID } from 'crypto';

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
}));

// Get typed access to mocked constructors
const { GetCommand, QueryCommand, TransactWriteCommand } = await import(
  '@aws-sdk/lib-dynamodb'
);
const mockGetCommand = vi.mocked(GetCommand);
const mockQueryCommand = vi.mocked(QueryCommand);
const mockTransactWriteCommand = vi.mocked(TransactWriteCommand);

describe('DynamoUserRepository', () => {
  let repository: DynamoUserRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new DynamoUserRepository({
      tableName: 'test-table',
      region: 'us-east-1',
      testUserTtlSeconds: 600, // 10 minutes
    });
  });

  describe('save', () => {
    it('should save a new user successfully', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        name: 'john-doe',
        isTest: false,
        createdAt: new Date(),
      });
      mockSend.mockResolvedValueOnce({});

      // When
      const savedUser = await repository.save(user);

      // Then
      expect(savedUser).toBeDefined();
      expect(savedUser.id).toBe(user.id);
      expect(savedUser.name).toBe(user.name);

      // Verify TransactWriteCommand was created with correct parameters
      expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);
      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: [
            {
              Put: {
                TableName: 'test-table',
                Item: expect.objectContaining({
                  PK: `USERNAME#${user.name}`,
                  SK: 'USERNAME',
                  userId: user.id,
                  createdAt: expect.any(String),
                }),
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: 'test-table',
                Item: expect.objectContaining({
                  PK: `USER#${user.id}`,
                  SK: 'PROFILE',
                  AUTH_GSI1PK: `USERNAME#${user.name}`,
                  AUTH_GSI1SK: 'PROFILE',
                  id: user.id,
                  name: user.name,
                  isTest: false,
                }),
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        })
      );

      // Verify send was called once
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw UserAlreadyExistsError when user already exists (ConditionalCheckFailedException)', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        name: 'john-doe',
        isTest: false,
        createdAt: new Date(),
      });

      const conditionalError = new Error('The conditional request failed');
      conditionalError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionalError);

      // When & Then
      await expect(repository.save(user)).rejects.toThrow(
        UserAlreadyExistsError
      );

      // Verify TransactWriteCommand was attempted
      expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw UserAlreadyExistsError when transaction is cancelled (TransactionCanceledException)', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        name: 'john-doe',
        isTest: false,
        createdAt: new Date(),
      });

      const transactionError = new Error('Transaction cancelled');
      transactionError.name = 'TransactionCanceledException';
      mockSend.mockRejectedValueOnce(transactionError);

      // When & Then
      await expect(repository.save(user)).rejects.toThrow(
        UserAlreadyExistsError
      );

      // Verify TransactWriteCommand was attempted
      expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should wrap other DynamoDB errors in AuthRepositoryError', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        name: 'john-doe',
        isTest: false,
        createdAt: new Date(),
      });

      const dynamoError = new Error('Service unavailable');
      dynamoError.name = 'ServiceUnavailableException';
      mockSend.mockRejectedValue(dynamoError);

      // When & Then
      await expect(repository.save(user)).rejects.toThrow(
        new AuthRepositoryError('save user', dynamoError)
      );

      // Verify TransactWriteCommand was attempted
      expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should save test users with TTL', async () => {
      // Given
      const testUser = new User({
        id: randomUUID(),
        name: 'test-user',
        isTest: true,
        createdAt: new Date(),
      });
      mockSend.mockResolvedValueOnce({});

      // When
      const savedUser = await repository.save(testUser);

      // Then
      expect(savedUser).toBeDefined();
      expect(savedUser.isTest).toBe(true);

      // Verify TransactWriteCommand was created with TTL for test user
      expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);
      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: [
            {
              Put: {
                TableName: 'test-table',
                Item: expect.objectContaining({
                  PK: `USERNAME#${testUser.name}`,
                  SK: 'USERNAME',
                  userId: testUser.id,
                  createdAt: expect.any(String),
                  ttl: expect.any(Number),
                }),
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: 'test-table',
                Item: expect.objectContaining({
                  PK: `USER#${testUser.id}`,
                  SK: 'PROFILE',
                  AUTH_GSI1PK: `USERNAME#${testUser.name}`,
                  AUTH_GSI1SK: 'PROFILE',
                  id: testUser.id,
                  name: testUser.name,
                  isTest: true,
                  ttl: expect.any(Number),
                }),
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        })
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        name: 'john-doe',
        isTest: false,
        createdAt: new Date(),
      });
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: `USER#${user.id}`,
          SK: 'PROFILE',
          AUTH_GSI1PK: `USERNAME#${user.name}`,
          AUTH_GSI1SK: 'PROFILE',
          id: user.id,
          name: user.name,
          createdAt: user.createdAt.toISOString(),
          isTest: false,
        },
      });

      // When
      const foundUser = await repository.findById(user.id);

      // Then
      expect(foundUser).toBeDefined();
      expect(foundUser!.id).toBe(user.id);
      expect(foundUser!.name).toBe(user.name);
      expect(foundUser!.isTest).toBe(false);

      // Verify GetCommand was created with correct parameters
      expect(mockGetCommand).toHaveBeenCalledTimes(1);
      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-table',
          Key: {
            PK: `USER#${user.id}`,
            SK: 'PROFILE',
          },
        })
      );

      // Verify send was called once
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should return null when user not found', async () => {
      // Given
      const nonExistentId = 'non-existent';
      mockSend.mockResolvedValueOnce({ Item: undefined });

      // When
      const foundUser = await repository.findById(nonExistentId);

      // Then
      expect(foundUser).toBeNull();

      // Verify GetCommand was created with correct parameters
      expect(mockGetCommand).toHaveBeenCalledTimes(1);
      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-table',
          Key: {
            PK: `USER#${nonExistentId}`,
            SK: 'PROFILE',
          },
        })
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('findByName', () => {
    it('should return user when found by name', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        name: 'john-doe',
        isTest: false,
        createdAt: new Date(),
      });
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: `USER#${user.id}`,
            SK: 'PROFILE',
            AUTH_GSI1PK: `USERNAME#${user.name}`,
            AUTH_GSI1SK: 'PROFILE',
            id: user.id,
            name: user.name,
            createdAt: user.createdAt.toISOString(),
            isTest: false,
          },
        ],
      });

      // When
      const foundUser = await repository.findByName(user.name);

      // Then
      expect(foundUser).toBeDefined();
      expect(foundUser!.id).toBe(user.id);
      expect(foundUser!.name).toBe(user.name);

      // Verify QueryCommand was created with correct parameters
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-table',
          IndexName: 'AUTH_GSI1',
          KeyConditionExpression: 'AUTH_GSI1PK = :name AND AUTH_GSI1SK = :sk',
          ExpressionAttributeValues: {
            ':name': `USERNAME#${user.name}`,
            ':sk': 'PROFILE',
          },
        })
      );

      // Verify send was called once
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should return null when user not found by name', async () => {
      // Given
      const nonExistentName = 'non-existent';
      mockSend.mockResolvedValueOnce({ Items: [] });

      // When
      const foundUser = await repository.findByName(nonExistentName);

      // Then
      expect(foundUser).toBeNull();

      // Verify QueryCommand was created with correct parameters
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-table',
          IndexName: 'AUTH_GSI1',
          KeyConditionExpression: 'AUTH_GSI1PK = :name AND AUTH_GSI1SK = :sk',
          ExpressionAttributeValues: {
            ':name': `USERNAME#${nonExistentName}`,
            ':sk': 'PROFILE',
          },
        })
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
