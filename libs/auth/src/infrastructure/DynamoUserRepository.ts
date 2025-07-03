import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { UserRepository } from '../application/ports';
import {
  User,
  UserId,
  UserName,
  UserPersistenceData,
} from '../domain/entities/User';
import { UserAlreadyExistsError } from '../domain/errors';

export interface DynamoUserRepositoryConfig {
  tableName: string;
  region: string;
  testUserTtlSeconds: number;
  endpoint?: string; // For LocalStack testing
}

interface UsernameReservationDbItem {
  PK: string; // USERNAME#{userName}
  SK: 'USERNAME';
  userId: UserId;
  createdAt: string;
  ttl?: number; // Optional TTL for test users
}

interface UserProfileDbItem {
  PK: string; // USER#{userId}
  SK: 'PROFILE';
  GSI1PK: string; // USERNAME#{userName}
  GSI1SK: 'PROFILE';
  id: UserId;
  name: UserName;
  createdAt: string;
  isTest: boolean;
  ttl?: number; // Optional TTL for test users
}

// Type for unknown DynamoDB items (when reading from DB)
interface UnknownDbItem {
  PK?: string;
  SK?: string;
  GSI1PK?: string;
  GSI1SK?: string;
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
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
    });

    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = config.tableName;
    this.testUserTtlSeconds = config.testUserTtlSeconds;
  }

  async save(user: User): Promise<User> {
    const persistence = user.toPersistence();
    const userProfileItem = this.toUserProfileDbItem(persistence);
    const usernameReservationItem =
      this.toUsernameReservationDbItem(persistence);

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
      if (this.isConditionalCheckFailedException(error)) {
        throw new UserAlreadyExistsError(user.name);
      }

      throw error;
    }
  }

  async findById(userId: UserId): Promise<User | null> {
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

      return this.fromDbItem(result.Item);
    } catch (error: unknown) {
      console.error('Error finding user by ID in database:', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  async findByName(userName: UserName): Promise<User | null> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :name AND GSI1SK = :sk',
          ExpressionAttributeValues: {
            ':name': `USERNAME#${userName}`,
            ':sk': 'PROFILE',
          },
        })
      );

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      return this.fromDbItem(result.Items[0]);
    } catch (error: unknown) {
      console.error('Error finding user by name in database:', {
        userName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  private toUsernameReservationDbItem(
    persistence: UserPersistenceData
  ): UsernameReservationDbItem {
    const item: UsernameReservationDbItem = {
      PK: `USERNAME#${persistence.name}`,
      SK: 'USERNAME', // Fixed value for username reservations
      userId: persistence.id,
      createdAt: persistence.createdAt,
    };

    // Add TTL for test users
    if (persistence.isTest) {
      item.ttl = Math.floor(Date.now() / 1000) + this.testUserTtlSeconds;
    }

    return item;
  }

  private toUserProfileDbItem(
    persistence: UserPersistenceData
  ): UserProfileDbItem {
    const item: UserProfileDbItem = {
      PK: `USER#${persistence.id}`,
      SK: 'PROFILE', // Use PROFILE for user authentication data
      GSI1PK: `USERNAME#${persistence.name}`,
      GSI1SK: 'PROFILE', // Only index profile records for username lookup
      id: persistence.id,
      name: persistence.name,
      createdAt: persistence.createdAt,
      isTest: persistence.isTest,
    };

    // Add TTL for test users
    if (persistence.isTest) {
      item.ttl = Math.floor(Date.now() / 1000) + this.testUserTtlSeconds;
    }

    return item;
  }

  private fromDbItem(item: UnknownDbItem): User {
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

    const persistence: UserPersistenceData = {
      id: item.id as UserId,
      name: item.name as UserName,
      createdAt: item.createdAt,
      isTest: item.isTest || false,
    };

    return User.fromPersistence(persistence);
  }

  private isConditionalCheckFailedException(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'ConditionalCheckFailedException' ||
        error.name === 'TransactionCanceledException')
    );
  }
}
