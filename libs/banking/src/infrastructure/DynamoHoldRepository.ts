import {
  DynamoDBClient,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  HoldRepository,
  ReserveHoldRequest,
  ReserveHoldResult,
  ReleaseHoldRequest,
  ReleaseHoldResult,
} from '../application/HoldRepository';
import type { Hold, HoldEvent } from '../domain/entities/Hold';
import {
  buildHoldMetaItem,
  buildHoldEventItem,
  mapHoldMetaItemToHold,
  HOLD_ITEM_CONSTANTS,
  HoldMetaItem,
  buildHoldPartitionKey,
} from './dynamo/holds/items';
import {
  buildHoldIdempotencyItem,
  HOLD_IDEMPOTENCY_CONSTANTS,
} from './dynamo/holds/idempotency';
import {
  TABLE_PREFIXES,
  SORT_KEYS,
  CONDITION_EXPRESSIONS,
  EXPRESSION_ATTRIBUTE_NAMES,
  DYNAMO_ERROR_CODES,
} from './dynamo/constants';
import { hashIdempotencyKey } from '../domain/idempotency';
import type {
  Logger,
  Metrics,
  PaginationOptions,
  PaginatedResult,
} from '../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  METRIC_UNITS,
  OPERATION_NAMES,
} from '@demo-bank-app/shared-observability';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import { RepositoryError, OptimisticLockError } from './repositoryErrors';
import { InsufficientFundsError } from '../domain/errors';

interface AccountBalanceItem {
  availableBalanceMinor: number;
  ledgerBalanceMinor: number;
  version: number;
}

export interface DynamoHoldRepositoryConfig {
  tableName: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  logger?: Logger;
  metrics?: Metrics;
  documentClient?: DynamoDBDocumentClient;
}

export class DynamoHoldRepository implements HoldRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly logger?: Logger;
  private readonly metrics?: Metrics;

  constructor(config: DynamoHoldRepositoryConfig) {
    if (config.documentClient) {
      this.client = config.documentClient;
    } else {
      const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
      const dynamoClient = new DynamoDBClient({
        region: config.region,
        ...(config.endpoint && { endpoint: config.endpoint }),
        ...(config.credentials && { credentials: config.credentials }),
        ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
      });
      this.client = DynamoDBDocumentClient.from(dynamoClient);
    }
    this.tableName = config.tableName;
    this.logger = config.logger;
    this.metrics = config.metrics;
  }

  async reserveHold(request: ReserveHoldRequest): Promise<ReserveHoldResult> {
    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.BANKING?.RESERVE_FUNDS_REPOSITORY ??
        'ReserveFundsRepository'
    );

    const holdMetaItem = buildHoldMetaItem(request.hold);
    const holdEventItem = buildHoldEventItem(
      request.hold.holdId,
      request.holdEvent
    );
    const idempotencyItem = buildHoldIdempotencyItem({
      userId: request.userId,
      idempotencyKey: request.idempotencyKey,
      holdId: request.hold.holdId,
      command: 'RESERVE',
      createdAt: request.holdEvent.at,
    });

    const accountKey = {
      PK: `${TABLE_PREFIXES.ACCOUNT}${request.accountId}`,
      SK: SORT_KEYS.BALANCE,
    };

    const transactItems = [
      {
        Update: {
          TableName: this.tableName,
          Key: accountKey,
          UpdateExpression:
            'SET availableBalanceMinor = availableBalanceMinor - :amount, #version = #version + :inc',
          ConditionExpression: `${EXPRESSION_ATTRIBUTE_NAMES.VERSION} = :currentVersion AND availableBalanceMinor >= :amount`,
          ExpressionAttributeNames: {
            [EXPRESSION_ATTRIBUTE_NAMES.VERSION]: 'version',
          },
          ExpressionAttributeValues: {
            ':amount': request.amountMinor,
            ':inc': 1,
            ':currentVersion': request.accountBalanceVersion,
          },
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: holdMetaItem,
          ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: holdEventItem,
          ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: idempotencyItem,
          ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
        },
      },
    ];

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: transactItems,
        })
      );

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.BANKING?.RESERVE_FUNDS_REPOSITORY_SUCCESS ??
          'ReserveFundsRepositorySuccess',
        METRIC_UNITS.COUNT,
        1
      );
      this.metrics?.addMetric(
        METRIC_NAMES.BANKING?.RESERVE_FUNDS_REPOSITORY_DURATION ??
          'ReserveFundsRepositoryDuration',
        METRIC_UNITS.MILLISECONDS,
        completedTiming.duration ?? 0
      );

      this.logger?.debug('Hold reserved successfully in repository', {
        holdId: request.hold.holdId,
        accountId: request.accountId,
        amountMinor: request.amountMinor,
        userId: request.userId,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return { hold: request.hold, created: true };
    } catch (error) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.BANKING?.RESERVE_FUNDS_REPOSITORY_ERROR ??
          'ReserveFundsRepositoryError',
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.error('Hold reservation transaction failed', {
        holdId: request.hold.holdId,
        accountId: request.accountId,
        amountMinor: request.amountMinor,
        userId: request.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      return this.handleReserveError(error, request);
    }
  }

  async putHoldMeta(hold: Hold): Promise<void> {
    const holdMetaItem = buildHoldMetaItem(hold);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: holdMetaItem,
      })
    );
  }

  async appendHoldEvent(
    holdId: Hold['holdId'],
    event: HoldEvent
  ): Promise<void> {
    const holdEventItem = buildHoldEventItem(holdId, event);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: holdEventItem,
      })
    );
  }

  async getHold(holdId: Hold['holdId']): Promise<Hold | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${holdId}`,
          SK: HOLD_ITEM_CONSTANTS.SORT_KEYS.META,
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    return mapHoldMetaItemToHold(result.Item as HoldMetaItem);
  }

  async listPendingHoldsByAccountNumber(
    accountNumber: Hold['payerAccountNumber'],
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<Hold>> {
    const exclusiveStartKey =
      options.nextToken && options.nextToken.length > 0
        ? this.decodePaginationToken(options.nextToken)
        : undefined;

    const query = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: HOLD_ITEM_CONSTANTS.GSI_NAMES.HOLD_GSI1,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': HOLD_ITEM_CONSTANTS.GSI1_KEYS.PK,
          '#sk': HOLD_ITEM_CONSTANTS.GSI1_KEYS.SK,
        },
        ExpressionAttributeValues: {
          ':pk': `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.ACCOUNT}${accountNumber}`,
          ':skPrefix': 'PENDING#',
        },
        ScanIndexForward: false,
        Limit: options.limit,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    const holds =
      query.Items?.map(item => mapHoldMetaItemToHold(item as HoldMetaItem)) ??
      [];

    return {
      items: holds,
      nextToken: query.LastEvaluatedKey
        ? this.encodePaginationToken(query.LastEvaluatedKey)
        : undefined,
      hasMore: Boolean(query.LastEvaluatedKey),
    };
  }

  async releaseHold(request: ReleaseHoldRequest): Promise<ReleaseHoldResult> {
    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.BANKING?.RELEASE_HOLD_REPOSITORY ??
        'ReleaseHoldRepository'
    );

    const accountKey = {
      PK: `${TABLE_PREFIXES.ACCOUNT}${request.accountId}`,
      SK: SORT_KEYS.BALANCE,
    };

    const holdPartitionKey = buildHoldPartitionKey(request.hold.holdId);
    const updatedHoldMeta = buildHoldMetaItem(request.hold);
    const holdUpdateExpressions = [
      '#status = :releasedStatus',
      'HOLD_GSI1SK = :gsi1sk',
      'releasedAt = :releasedAt',
    ];
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':releasedStatus': request.hold.status,
      ':pendingStatus': 'PENDING',
      ':gsi1sk': updatedHoldMeta.HOLD_GSI1SK,
      ':releasedAt': request.hold.releasedAt,
    };

    const removeExpressions: string[] = [];
    if (request.hold.releaseReason) {
      holdUpdateExpressions.push('releaseReason = :releaseReason');
      expressionAttributeValues[':releaseReason'] = request.hold.releaseReason;
    } else {
      removeExpressions.push('releaseReason');
    }

    const holdUpdateExpression =
      `SET ${holdUpdateExpressions.join(', ')}` +
      (removeExpressions.length > 0
        ? ` REMOVE ${removeExpressions.join(', ')}`
        : '');

    const holdEventItem = buildHoldEventItem(
      request.hold.holdId,
      request.holdEvent
    );
    const idempotencyItem = buildHoldIdempotencyItem({
      userId: request.userId,
      idempotencyKey: request.idempotencyKey,
      holdId: request.hold.holdId,
      command: 'RELEASE',
      createdAt: request.holdEvent.at,
    });

    const transactItems = [
      {
        Update: {
          TableName: this.tableName,
          Key: accountKey,
          UpdateExpression:
            'SET availableBalanceMinor = availableBalanceMinor + :amount, #version = #version + :inc',
          ConditionExpression: `${EXPRESSION_ATTRIBUTE_NAMES.VERSION} = :currentVersion`,
          ExpressionAttributeNames: {
            [EXPRESSION_ATTRIBUTE_NAMES.VERSION]: 'version',
          },
          ExpressionAttributeValues: {
            ':amount': request.amountMinor,
            ':inc': 1,
            ':currentVersion': request.accountBalanceVersion,
          },
        },
      },
      {
        Update: {
          TableName: this.tableName,
          Key: {
            PK: holdPartitionKey,
            SK: HOLD_ITEM_CONSTANTS.SORT_KEYS.META,
          },
          UpdateExpression: holdUpdateExpression,
          ConditionExpression: '#status = :pendingStatus',
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: {
            ...expressionAttributeValues,
          },
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: holdEventItem,
          ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: idempotencyItem,
          ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
        },
      },
    ];

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: transactItems,
        })
      );

      const completedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.BANKING?.RELEASE_HOLD_REPOSITORY_SUCCESS ??
          'ReleaseHoldRepositorySuccess',
        METRIC_UNITS.COUNT,
        1
      );
      this.metrics?.addMetric(
        METRIC_NAMES.BANKING?.RELEASE_HOLD_REPOSITORY_DURATION ??
          'ReleaseHoldRepositoryDuration',
        METRIC_UNITS.MILLISECONDS,
        completedTiming.duration ?? 0
      );

      this.logger?.debug('Hold released successfully in repository', {
        holdId: request.hold.holdId,
        accountId: request.accountId,
        amountMinor: request.amountMinor,
        userId: request.userId,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return { hold: request.hold, created: true };
    } catch (error) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.BANKING?.RELEASE_HOLD_REPOSITORY_ERROR ??
          'ReleaseHoldRepositoryError',
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.error('Hold release transaction failed', {
        holdId: request.hold.holdId,
        accountId: request.accountId,
        amountMinor: request.amountMinor,
        userId: request.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      return this.handleReleaseError(error, request);
    }
  }

  private async handleReserveError(
    error: unknown,
    request: ReserveHoldRequest
  ): Promise<ReserveHoldResult> {
    if (
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.[3]?.Code ===
        DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
    ) {
      const holdId = await this.getHoldIdByIdempotencyKey(
        request.userId,
        request.idempotencyKey
      );
      const hold = await this.getHold(holdId);
      if (!hold) {
        throw new RepositoryError(
          `hold_idempotency_lookup_${holdId}`,
          new Error('Hold not found after idempotency lookup')
        );
      }
      return { hold, created: false };
    }

    if (
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.[0]?.Code ===
        DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
    ) {
      const balance = await this.getAccountBalanceItem(request.accountId);
      if (!balance) {
        throw new OptimisticLockError(`hold_reserve_${request.hold.holdId}`);
      }

      if (balance.availableBalanceMinor < request.amountMinor) {
        throw new InsufficientFundsError(
          request.amountMinor,
          balance.availableBalanceMinor
        );
      }

      throw new OptimisticLockError(`hold_reserve_${request.hold.holdId}`);
    }

    if (
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.some(
        reason => reason.Code === DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
      )
    ) {
      throw new OptimisticLockError(`hold_reserve_${request.hold.holdId}`);
    }

    throw new RepositoryError(
      `hold_reserve_${request.hold.holdId}`,
      error as Error
    );
  }

  private async handleReleaseError(
    error: unknown,
    request: ReleaseHoldRequest
  ): Promise<ReleaseHoldResult> {
    if (
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.[3]?.Code ===
        DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
    ) {
      const holdId = await this.getHoldIdByIdempotencyKey(
        request.userId,
        request.idempotencyKey
      );
      const hold = await this.getHold(holdId);
      if (!hold) {
        throw new RepositoryError(
          `hold_idempotency_lookup_${holdId}`,
          new Error('Hold not found after idempotency lookup')
        );
      }
      return { hold, created: false };
    }

    if (
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.[0]?.Code ===
        DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
    ) {
      throw new OptimisticLockError(`hold_release_${request.hold.holdId}`);
    }

    if (
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.[1]?.Code ===
        DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
    ) {
      throw new OptimisticLockError(`hold_release_${request.hold.holdId}`);
    }

    if (
      error instanceof TransactionCanceledException &&
      error.CancellationReasons?.some(
        reason => reason.Code === DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
      )
    ) {
      throw new OptimisticLockError(`hold_release_${request.hold.holdId}`);
    }

    throw new RepositoryError(
      `hold_release_${request.hold.holdId}`,
      error as Error
    );
  }

  private async getAccountBalanceItem(
    accountId: string
  ): Promise<AccountBalanceItem | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${accountId}`,
          SK: SORT_KEYS.BALANCE,
        },
        ProjectionExpression:
          'availableBalanceMinor, ledgerBalanceMinor, version',
        ConsistentRead: true,
      })
    );

    if (!result.Item) {
      return null;
    }

    return result.Item as AccountBalanceItem;
  }

  private async getHoldIdByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<string> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.USER}${userId}`,
          SK: `${
            HOLD_IDEMPOTENCY_CONSTANTS.SORT_KEY_PREFIX
          }${hashIdempotencyKey(idempotencyKey)}`,
        },
        ProjectionExpression: 'holdId',
        ConsistentRead: true,
      })
    );

    if (!result.Item || !result.Item.holdId) {
      throw new RepositoryError(
        `hold_idempotency_lookup_${userId}_${idempotencyKey}`,
        new Error('Hold idempotency record missing holdId')
      );
    }

    return result.Item.holdId as string;
  }

  private encodePaginationToken(key: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(key), 'utf8').toString('base64');
  }

  private decodePaginationToken(token: string): Record<string, unknown> {
    try {
      return JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    } catch (error) {
      throw new RepositoryError('hold_pagination_token_decode', error as Error);
    }
  }
}
