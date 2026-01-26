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
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type { Logger, Metrics } from '@demo-bank-app/shared-observability';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';

export interface DynamoUserRepositoryConfig {
  tableName: string;
  region: string;
  testUserTtlSeconds: number;
  endpoint?: string; // For LocalStack testing
  credentials?: { accessKeyId: string; secretAccessKey: string };
  logger?: Logger;
  metrics?: Metrics;
}

interface EmailReservationDbItem {
  PK: string; // EMAIL#{userEmail}
  SK: 'EMAIL';
  userId: User['id'];
  createdAt: string;
  ttl?: number; // Optional TTL for test users
}

interface UserProfileDbItem {
  PK: string; // USER#{userId}
  SK: 'PROFILE';
  AUTH_GSI1PK: string; // EMAIL#{userEmail}
  AUTH_GSI1SK: 'PROFILE';
  id: User['id'];
  email: User['email'];
  createdAt: string;
  isTest: boolean;
  marketingEmailsOptIn: boolean;
  merchantId?: User['merchantId'];
  ttl?: number; // Optional TTL for test users
}

// Type for unknown DynamoDB items (when reading from DB)
interface UnknownDbItem {
  PK?: string;
  SK?: string;
  AUTH_GSI1PK?: string;
  AUTH_GSI1SK?: string;
  id?: string;
  email?: string;
  createdAt?: string;
  isTest?: boolean;
  marketingEmailsOptIn?: boolean;
  merchantId?: string;
  ttl?: number;
  [key: string]: unknown; // Allow additional properties
}

export class DynamoUserRepository implements UserRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly testUserTtlSeconds: number;
  private readonly logger?: Logger;
  private readonly metrics?: Metrics;

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
    this.logger = config.logger;
    this.metrics = config.metrics;
  }

  async save(user: User): Promise<User> {
    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.AUTH.USER_REPOSITORY_SAVE
    );

    this.logger?.info('User repository save started', {
      userId: user.id,
      userEmail: user.email,
      isTest: user.isTest,
      ...TimingUtils.createTimingMetadata(timing),
    });

    const userProfileItem = this.buildUserProfileItem(user);
    const emailReservationItem = this.buildEmailReservationItem(user);

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: emailReservationItem,
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

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.USER_REPOSITORY_SAVE_SUCCESS,
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.info('User repository save completed', {
        userId: user.id,
        userEmail: user.email,
        isTest: user.isTest,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return user;
    } catch (error: unknown) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.logger?.error('User repository save failed', {
        userId: user.id,
        userEmail: user.email,
        isTest: user.isTest,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.USER_REPOSITORY_SAVE_ERROR,
        METRIC_UNITS.COUNT,
        1
      );

      if (
        this.isConditionalCheckFailedException(error) ||
        this.isTransactionCanceledException(error)
      ) {
        throw new UserAlreadyExistsError(user.email);
      }

      throw new AuthRepositoryError(
        'save user',
        error instanceof Error ? error : undefined
      );
    }
  }

  async findById(userId: User['id']): Promise<User | null> {
    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.AUTH.USER_REPOSITORY_FIND
    );

    this.logger?.debug('User repository find by id started', {
      userId: userId,
      findBy: 'id',
      ...TimingUtils.createTimingMetadata(timing),
    });

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
        const completedTiming = TimingUtils.endTiming(timing);

        this.metrics?.addMetric(
          METRIC_NAMES.AUTH.USER_REPOSITORY_FIND_SUCCESS,
          METRIC_UNITS.COUNT,
          1
        );

        this.logger?.debug('User repository find completed', {
          userId: userId,
          findBy: 'id',
          found: false,
          ...TimingUtils.createTimingMetadata(completedTiming),
        });

        return null;
      }

      const user = this.mapToUser(result.Item);

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.USER_REPOSITORY_FIND_SUCCESS,
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.debug('User repository find by id completed', {
        userId: userId,
        findBy: 'id',
        found: true,
        userEmail: user.email,
        isTest: user.isTest,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return user;
    } catch (error: unknown) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.logger?.error('User repository find by id failed', {
        userId: userId,
        findBy: 'id',
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.USER_REPOSITORY_FIND_ERROR,
        METRIC_UNITS.COUNT,
        1
      );

      throw new AuthRepositoryError(
        'find user by id',
        error instanceof Error ? error : undefined
      );
    }
  }

  async findByEmail(userEmail: User['email']): Promise<User | null> {
    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.AUTH.USER_REPOSITORY_FIND
    );

    this.logger?.debug('User repository find by email started', {
      userEmail,
      findBy: 'email',
      ...TimingUtils.createTimingMetadata(timing),
    });

    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'AUTH_GSI1',
          KeyConditionExpression:
            'AUTH_GSI1PK = :gsi1pk AND AUTH_GSI1SK = :gsi1sk',
          ExpressionAttributeValues: {
            ':gsi1pk': `EMAIL#${userEmail}`,
            ':gsi1sk': 'PROFILE',
          },
        })
      );

      if (!result.Items || result.Items.length === 0) {
        const completedTiming = TimingUtils.endTiming(timing);

        this.metrics?.addMetric(
          METRIC_NAMES.AUTH.USER_REPOSITORY_FIND_SUCCESS,
          METRIC_UNITS.COUNT,
          1
        );

        this.logger?.debug('User repository find by email completed', {
          userEmail,
          findBy: 'email',
          found: false,
          ...TimingUtils.createTimingMetadata(completedTiming),
        });

        return null;
      }

      const user = this.mapToUser(result.Items[0]);

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.USER_REPOSITORY_FIND_SUCCESS,
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.debug('User repository find by email completed', {
        userEmail,
        findBy: 'email',
        found: true,
        userId: user.id,
        isTest: user.isTest,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return user;
    } catch (error: unknown) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.logger?.error('User repository find by email failed', {
        userEmail,
        findBy: 'email',
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      this.metrics?.addMetric(
        METRIC_NAMES.AUTH.USER_REPOSITORY_FIND_ERROR,
        METRIC_UNITS.COUNT,
        1
      );

      throw new AuthRepositoryError(
        'find user by email',
        error instanceof Error ? error : undefined
      );
    }
  }

  private buildEmailReservationItem(user: User): EmailReservationDbItem {
    const item: EmailReservationDbItem = {
      PK: `EMAIL#${user.email}`,
      SK: 'EMAIL', // Fixed value for email reservations
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
      AUTH_GSI1PK: `EMAIL#${user.email}`,
      AUTH_GSI1SK: 'PROFILE', // Only index profile records for email lookup
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      isTest: user.isTest,
      marketingEmailsOptIn: user.marketingEmailsOptIn,
      ...(user.merchantId ? { merchantId: user.merchantId } : {}),
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
      if (!item.id || !item.email || !item.createdAt) {
        throw new Error('Invalid user item: missing required fields');
      }

      if (
        typeof item.id !== 'string' ||
        typeof item.email !== 'string' ||
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

      const marketingOptInValue = item.marketingEmailsOptIn;
      if (
        marketingOptInValue !== undefined &&
        typeof marketingOptInValue !== 'boolean'
      ) {
        throw new Error(
          'Invalid user item: marketingEmailsOptIn must be boolean'
        );
      }
      const marketingEmailsOptIn = marketingOptInValue ?? false;

      const merchantIdValue = item.merchantId;
      if (
        merchantIdValue !== undefined &&
        merchantIdValue !== null &&
        typeof merchantIdValue !== 'string'
      ) {
        throw new Error('Invalid user item: merchantId must be string');
      }
      const normalizedMerchantId = merchantIdValue?.trim();
      if (merchantIdValue !== undefined && normalizedMerchantId === '') {
        throw new Error('Invalid user item: merchantId cannot be empty');
      }

      return new User({
        id: item.id,
        email: item.email,
        createdAt,
        isTest,
        marketingEmailsOptIn,
        merchantId: normalizedMerchantId || undefined,
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
