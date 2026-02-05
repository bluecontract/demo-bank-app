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
  UpdateCommand: vi.fn(),
}));

// Get typed access to mocked constructors
const { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } =
  await import('@aws-sdk/lib-dynamodb');
const mockGetCommand = vi.mocked(GetCommand);
const mockQueryCommand = vi.mocked(QueryCommand);
const mockTransactWriteCommand = vi.mocked(TransactWriteCommand);
const mockUpdateCommand = vi.mocked(UpdateCommand);

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
        email: 'john.doe@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });
      mockSend.mockResolvedValueOnce({});

      // When
      const savedUser = await repository.save(user);

      // Then
      expect(savedUser).toBeDefined();
      expect(savedUser.id).toBe(user.id);
      expect(savedUser.email).toBe(user.email);

      // Verify TransactWriteCommand was created with correct parameters
      expect(mockTransactWriteCommand).toHaveBeenCalledTimes(1);
      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: [
            {
              Put: {
                TableName: 'test-table',
                Item: expect.objectContaining({
                  PK: `EMAIL#${user.email}`,
                  SK: 'EMAIL',
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
                  AUTH_GSI1PK: `EMAIL#${user.email}`,
                  AUTH_GSI1SK: 'PROFILE',
                  id: user.id,
                  email: user.email,
                  isTest: false,
                  marketingEmailsOptIn: true,
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

    it('should persist merchantId when provided', async () => {
      const user = new User({
        id: randomUUID(),
        email: 'merchant.user@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
        merchantId: 'merchant-123',
      });
      mockSend.mockResolvedValueOnce({});

      await repository.save(user);

      expect(mockTransactWriteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TransactItems: expect.arrayContaining([
            {
              Put: {
                TableName: 'test-table',
                Item: expect.objectContaining({
                  PK: `USER#${user.id}`,
                  SK: 'PROFILE',
                  merchantId: 'merchant-123',
                }),
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ]),
        })
      );
    });

    it('should throw UserAlreadyExistsError when user already exists (ConditionalCheckFailedException)', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        email: 'john.doe@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
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
        email: 'john.doe@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
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
        email: 'john.doe@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
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
        email: 'test.user@example.com',
        isTest: true,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
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
                  PK: `EMAIL#${testUser.email}`,
                  SK: 'EMAIL',
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
                  AUTH_GSI1PK: `EMAIL#${testUser.email}`,
                  AUTH_GSI1SK: 'PROFILE',
                  id: testUser.id,
                  email: testUser.email,
                  isTest: true,
                  marketingEmailsOptIn: true,
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

  describe('updateProfile', () => {
    it('updates merchantName and avatarDataUrl', async () => {
      const userId = randomUUID();
      const updatedItem = {
        PK: `USER#${userId}`,
        SK: 'PROFILE',
        AUTH_GSI1PK: 'EMAIL#merchant@example.com',
        AUTH_GSI1SK: 'PROFILE',
        id: userId,
        email: 'merchant@example.com',
        createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
        isTest: false,
        marketingEmailsOptIn: true,
        merchantName: 'Demo Merchant',
        avatarDataUrl: 'data:image/png;base64,abc123',
      };

      mockSend.mockResolvedValueOnce({ Attributes: updatedItem });

      const result = await repository.updateProfile(userId, {
        merchantName: 'Demo Merchant',
        avatarDataUrl: 'data:image/png;base64,abc123',
      });

      expect(result.merchantName).toBe('Demo Merchant');
      expect(result.avatarDataUrl).toBe('data:image/png;base64,abc123');
      expect(mockUpdateCommand).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        email: 'john.doe@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: `USER#${user.id}`,
          SK: 'PROFILE',
          AUTH_GSI1PK: `EMAIL#${user.email}`,
          AUTH_GSI1SK: 'PROFILE',
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
          isTest: false,
          marketingEmailsOptIn: true,
        },
      });

      // When
      const foundUser = await repository.findById(user.id);

      // Then
      expect(foundUser).toBeDefined();
      expect(foundUser!.id).toBe(user.id);
      expect(foundUser!.email).toBe(user.email);
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

    it('should map merchantId when present', async () => {
      const user = new User({
        id: randomUUID(),
        email: 'merchant.lookup@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
        merchantId: 'merchant-lookup',
      });
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: `USER#${user.id}`,
          SK: 'PROFILE',
          AUTH_GSI1PK: `EMAIL#${user.email}`,
          AUTH_GSI1SK: 'PROFILE',
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
          isTest: false,
          marketingEmailsOptIn: true,
          merchantId: 'merchant-lookup',
        },
      });

      const foundUser = await repository.findById(user.id);

      expect(foundUser?.merchantId).toBe('merchant-lookup');
    });

    it('should map merchantName and avatarDataUrl when present', async () => {
      const user = new User({
        id: randomUUID(),
        email: 'merchant.avatar@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
        merchantName: 'Demo Merchant',
        avatarDataUrl: 'data:image/png;base64,abc123',
      });
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: `USER#${user.id}`,
          SK: 'PROFILE',
          AUTH_GSI1PK: `EMAIL#${user.email}`,
          AUTH_GSI1SK: 'PROFILE',
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
          isTest: false,
          marketingEmailsOptIn: true,
          merchantName: 'Demo Merchant',
          avatarDataUrl: 'data:image/png;base64,abc123',
        },
      });

      const foundUser = await repository.findById(user.id);

      expect(foundUser?.merchantName).toBe('Demo Merchant');
      expect(foundUser?.avatarDataUrl).toBe('data:image/png;base64,abc123');
    });
  });

  describe('findByEmail', () => {
    it('should return user when found by name', async () => {
      // Given
      const user = new User({
        id: randomUUID(),
        email: 'john.doe@example.com',
        isTest: false,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        marketingEmailsOptIn: true,
      });
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: `USER#${user.id}`,
            SK: 'PROFILE',
            AUTH_GSI1PK: `EMAIL#${user.email}`,
            AUTH_GSI1SK: 'PROFILE',
            id: user.id,
            email: user.email,
            createdAt: user.createdAt.toISOString(),
            isTest: false,
            marketingEmailsOptIn: true,
          },
        ],
      });

      // When
      const foundUser = await repository.findByEmail(user.email);

      // Then
      expect(foundUser).toBeDefined();
      expect(foundUser!.id).toBe(user.id);
      expect(foundUser!.email).toBe(user.email);

      // Verify QueryCommand was created with correct parameters
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-table',
          IndexName: 'AUTH_GSI1',
          KeyConditionExpression:
            'AUTH_GSI1PK = :gsi1pk AND AUTH_GSI1SK = :gsi1sk',
          ExpressionAttributeValues: {
            ':gsi1pk': `EMAIL#${user.email}`,
            ':gsi1sk': 'PROFILE',
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
      const foundUser = await repository.findByEmail(nonExistentName);

      // Then
      expect(foundUser).toBeNull();

      // Verify QueryCommand was created with correct parameters
      expect(mockQueryCommand).toHaveBeenCalledTimes(1);
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-table',
          IndexName: 'AUTH_GSI1',
          KeyConditionExpression:
            'AUTH_GSI1PK = :gsi1pk AND AUTH_GSI1SK = :gsi1sk',
          ExpressionAttributeValues: {
            ':gsi1pk': `EMAIL#${nonExistentName}`,
            ':gsi1sk': 'PROFILE',
          },
        })
      );

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
