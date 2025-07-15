import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { UserRepository } from '../application/ports';
import { User } from '../domain/entities/User';
import { UserAlreadyExistsError, AuthRepositoryError } from './errors';
import { AwsResilienceConfigBuilder } from '@demo-blue/shared-config';

export interface DynamoUserRepositoryConfig {
  tableName: string;
  region: string;
  testUserTtlSeconds: number;
  endpoint?: string; // For LocalStack testing
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

interface UsernameReservationDbItem {
  PK: string; // USERNAME#{userName}
  SK: 'USERNAME';
  userId: User['id'];
  createdAt: string;
  ttl?: number; // Optional TTL for test users
}

interface UserProfileDbItem {
  PK: string; // USER#{userId}
  SK: 'PROFILE';
  AUTH_GSI1PK: string; // USERNAME#{userName}
  AUTH_GSI1SK: 'PROFILE';
  id: User['id'];
  name: User['name'];
  createdAt: string;
  isTest: boolean;
  ttl?: number; // Optional TTL for test users
}

// Type for unknown DynamoDB items (when reading from DB)
interface UnknownDbItem {
  PK?: string;
  SK?: string;
  AUTH_GSI1PK?: string;
  AUTH_GSI1SK?: string;
  id?: string;
  name?: string;
  createdAt?: string;
  isTest?: boolean;
  ttl?: number;
  [key: string]: unknown; // Allow additional properties
}

export class DynamoUserRepository implements UserRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly testUserTtlSeconds: number;

  constructor(config: DynamoUserRepositoryConfig) {
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...(config.credentials && { credentials: config.credentials }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });

    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = config.tableName;
    this.testUserTtlSeconds = config.testUserTtlSeconds;
  }

  async save(user: User): Promise<User> {
    const userProfileItem = this.buildUserProfileItem(user);
    const usernameReservationItem = this.buildUsernameReservationItem(user);

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: usernameReservationItem,
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: userProfileItem,
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        })
      );

      return user;
    } catch (error: unknown) {
      if (
        this.isConditionalCheckFailedException(error) ||
        this.isTransactionCanceledException(error)
      ) {
        throw new UserAlreadyExistsError(user.name);
      }

      throw new AuthRepositoryError(
        'save user',
        error instanceof Error ? error : undefined
      );
    }
  }

  async findById(userId: User['id']): Promise<User | null> {
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            PK: `USER#${userId}`,
            SK: 'PROFILE',
          },
        })
      );

      if (!result.Item) {
        return null;
      }

      return this.mapToUser(result.Item);
    } catch (error: unknown) {
      throw new AuthRepositoryError(
        'find user by id',
        error instanceof Error ? error : undefined
      );
    }
  }

  async findByName(userName: User['name']): Promise<User | null> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'AUTH_GSI1',
          KeyConditionExpression: 'AUTH_GSI1PK = :name AND AUTH_GSI1SK = :sk',
          ExpressionAttributeValues: {
            ':name': `USERNAME#${userName}`,
            ':sk': 'PROFILE',
          },
        })
      );

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      return this.mapToUser(result.Items[0]);
    } catch (error: unknown) {
      throw new AuthRepositoryError(
        'find user by name',
        error instanceof Error ? error : undefined
      );
    }
  }

  private buildUsernameReservationItem(user: User): UsernameReservationDbItem {
    const item: UsernameReservationDbItem = {
      PK: `USERNAME#${user.name}`,
      SK: 'USERNAME', // Fixed value for username reservations
      userId: user.id,
      createdAt: user.createdAt.toISOString(),
    };

    // Add TTL for test users
    if (user.isTest) {
      item.ttl = Math.floor(Date.now() / 1000) + this.testUserTtlSeconds;
    }

    return item;
  }

  private buildUserProfileItem(user: User): UserProfileDbItem {
    const item: UserProfileDbItem = {
      PK: `USER#${user.id}`,
      SK: 'PROFILE', // Use PROFILE for user authentication data
      AUTH_GSI1PK: `USERNAME#${user.name}`,
      AUTH_GSI1SK: 'PROFILE', // Only index profile records for username lookup
      id: user.id,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      isTest: user.isTest,
    };

    // Add TTL for test users
    if (user.isTest) {
      item.ttl = Math.floor(Date.now() / 1000) + this.testUserTtlSeconds;
    }

    return item;
  }

  private mapToUser(item: UnknownDbItem): User {
    try {
      // Validate required fields exist and have correct types
      if (!item.id || !item.name || !item.createdAt) {
        throw new Error('Invalid user item: missing required fields');
      }

      if (
        typeof item.id !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.createdAt !== 'string'
      ) {
        throw new Error('Invalid user item: incorrect field types');
      }

      const createdAt = new Date(item.createdAt);
      if (isNaN(createdAt.getTime())) {
        throw new Error('Invalid user item: invalid createdAt date');
      }

      // Handle isTest field - use explicit type assertion after validation
      const isTestValue = item.isTest;
      if (
        isTestValue !== undefined &&
        isTestValue !== null &&
        typeof isTestValue !== 'boolean'
      ) {
        throw new Error('Invalid user item: isTest must be boolean');
      }
      const isTest = (isTestValue as boolean) ?? false;

      return new User({
        id: item.id,
        name: item.name,
        createdAt,
        isTest,
      });
    } catch (error: unknown) {
      throw new AuthRepositoryError(
        'map database item to user',
        error instanceof Error ? error : undefined
      );
    }
  }

  private isConditionalCheckFailedException(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'ConditionalCheckFailedException'
    );
  }

  private isTransactionCanceledException(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'TransactionCanceledException'
    );
  }
}
