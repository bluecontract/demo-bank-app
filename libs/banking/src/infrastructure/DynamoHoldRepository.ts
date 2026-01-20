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
import type { QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import type {
  HoldRepository,
  ReserveHoldRequest,
  ReserveHoldResult,
  ReleaseHoldRequest,
  ReleaseHoldResult,
  CaptureHoldRequest,
  CaptureHoldResult,
  HoldActivityRecord,
} from '../application/HoldRepository';
import type { Hold, HoldEvent } from '../domain/entities/Hold';
import type { CardTransactionDetails } from '../domain/valueObjects/CardTransactionDetails';
import { buildCardTransactionDetailsKey } from '../domain/valueObjects/CardTransactionDetails';
import {
  buildHoldMetaItem,
  buildHoldEventItem,
  mapHoldMetaItemToHold,
  HOLD_ITEM_CONSTANTS,
  HoldMetaItem,
  buildHoldPartitionKey,
  mapHoldEventItemToHoldEvent,
  type HoldEventItem,
} from './dynamo/holds/items';
import {
  buildHoldIdempotencyItem,
  buildHoldIdempotencySortKey,
  buildLegacyHoldIdempotencySortKey,
  type HoldIdempotencyCommand,
} from './dynamo/holds/idempotency';
import {
  TABLE_PREFIXES,
  SORT_KEYS,
  CONDITION_EXPRESSIONS,
  EXPRESSION_ATTRIBUTE_NAMES,
  DYNAMO_ERROR_CODES,
} from './dynamo/constants';
import {
  buildPostingPutItems,
  buildTransactionHeaderPutItem,
} from './dynamo/transactions/items';
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

const CARD_TRANSACTION_PREFIX = 'CARD_TXN#';
const CARD_TRANSACTION_SORT_KEY = 'META';

interface CardTransactionLookupItem {
  PK: string;
  SK: typeof CARD_TRANSACTION_SORT_KEY;
  holdId: string;
  payerAccountNumber: string;
  createdAt: string;
  cardTransactionDetails: CardTransactionDetails;
  processorChargeId?: string;
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

  private buildCardTransactionLookupItem(
    hold: Hold
  ): CardTransactionLookupItem | null {
    if (!hold.cardTransactionDetails) {
      return null;
    }

    const key = buildCardTransactionDetailsKey(hold.cardTransactionDetails);

    return {
      PK: `${CARD_TRANSACTION_PREFIX}${key}`,
      SK: CARD_TRANSACTION_SORT_KEY,
      holdId: hold.holdId,
      payerAccountNumber: hold.payerAccountNumber,
      createdAt: hold.createdAt,
      cardTransactionDetails: hold.cardTransactionDetails,
      ...(hold.processorChargeId
        ? { processorChargeId: hold.processorChargeId }
        : {}),
    };
  }

  async getHoldByCardTransactionDetails(
    details: CardTransactionDetails | undefined
  ): Promise<Hold | null> {
    if (!details) {
      return null;
    }

    const key = buildCardTransactionDetailsKey(details);
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `${CARD_TRANSACTION_PREFIX}${key}`,
          SK: CARD_TRANSACTION_SORT_KEY,
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const { holdId } = response.Item as { holdId?: string };
    if (!holdId) {
      return null;
    }

    return this.getHold(holdId);
  }

  async ensureCardTransactionMapping(hold: Hold): Promise<void> {
    const item = this.buildCardTransactionLookupItem(hold);
    if (!item) {
      return;
    }

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK) OR holdId = :holdId',
        ExpressionAttributeValues: {
          ':holdId': hold.holdId,
        },
      })
    );
  }

  async disableHoldCapture(holdId: Hold['holdId']): Promise<Hold | null> {
    const hold = await this.getHold(holdId);
    if (!hold) {
      return null;
    }

    if (hold.captureDisabled || hold.status !== 'PENDING') {
      return hold;
    }

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: {
                  PK: buildHoldPartitionKey(holdId),
                  SK: SORT_KEYS.META,
                },
                UpdateExpression: 'SET captureDisabled = :captureDisabled',
                ConditionExpression: '#status = :pendingStatus',
                ExpressionAttributeNames: {
                  '#status': 'status',
                },
                ExpressionAttributeValues: {
                  ':captureDisabled': true,
                  ':pendingStatus': 'PENDING',
                },
              },
            },
          ],
        })
      );
    } catch (error) {
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.[0]?.Code ===
          DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
      ) {
        return hold;
      }
      throw error;
    }

    return { ...hold, captureDisabled: true };
  }

  async reserveHold(request: ReserveHoldRequest): Promise<ReserveHoldResult> {
    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.BANKING?.RESERVE_FUNDS_REPOSITORY ??
        'ReserveFundsRepository'
    );

    const holdMetaItem = buildHoldMetaItem(request.hold);
    const holdEventItem = buildHoldEventItem(request.hold, request.holdEvent);
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
    const hold = await this.getHold(holdId);
    if (!hold) {
      throw new RepositoryError(
        `hold_append_event_${holdId}`,
        new Error('Hold not found while appending event')
      );
    }
    const holdEventItem = buildHoldEventItem(hold, event);
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

  async listHoldEvents(holdId: Hold['holdId']): Promise<HoldEvent[]> {
    const query = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :eventPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'PK',
          '#sk': 'SK',
        },
        ExpressionAttributeValues: {
          ':pk': `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${holdId}`,
          ':eventPrefix': HOLD_ITEM_CONSTANTS.SORT_KEYS.EVENT_PREFIX,
        },
        ScanIndexForward: true,
      })
    );

    const events = (query.Items ?? []) as HoldEventItem[];
    return events.map(item => mapHoldEventItemToHoldEvent(item));
  }

  async listHoldActivityByAccountNumber(
    accountNumber: Hold['payerAccountNumber'],
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<HoldActivityRecord>> {
    const pageLimit =
      typeof options.limit === 'number' && options.limit > 0
        ? Math.floor(options.limit)
        : undefined;

    const exclusiveStartKey =
      options.nextToken && options.nextToken.length > 0
        ? this.decodePaginationToken(options.nextToken)
        : undefined;

    const queryInput: QueryCommandInput = {
      TableName: this.tableName,
      IndexName: HOLD_ITEM_CONSTANTS.GSI_NAMES.HOLD_EVENT_GSI1,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: {
        '#pk': HOLD_ITEM_CONSTANTS.HOLD_EVENT_GSI1_KEYS.PK,
      },
      ExpressionAttributeValues: {
        ':pk': `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.ACCOUNT}${accountNumber}`,
      },
      ScanIndexForward: false,
    };

    if (pageLimit) {
      queryInput.Limit = pageLimit + 1;
    }

    if (exclusiveStartKey) {
      queryInput.ExclusiveStartKey = exclusiveStartKey;
    }

    const query = await this.client.send(new QueryCommand(queryInput));

    const events = (query.Items ?? []) as HoldEventItem[];
    const hasExtra = Boolean(pageLimit && events.length > pageLimit);
    const trimmedEvents =
      hasExtra && pageLimit ? events.slice(0, pageLimit) : events;

    const items: HoldActivityRecord[] = trimmedEvents.map(item => ({
      holdId: item.holdId,
      payerAccountNumber: item.payerAccountNumber,
      amountMinor: item.amountMinor,
      currency: item.currency,
      description: item.description,
      counterpartyAccountNumber: item.counterpartyAccountNumber,
      cardId: item.cardId,
      cardLast4: item.cardLast4,
      merchantName: item.merchantName,
      merchantStatementDescriptor: item.merchantStatementDescriptor,
      processorChargeId: item.processorChargeId,
      eventId: item.eventId,
      event: mapHoldEventItemToHoldEvent(item),
    }));

    const nextKeySource =
      hasExtra && pageLimit
        ? {
            PK: trimmedEvents[trimmedEvents.length - 1].PK,
            SK: trimmedEvents[trimmedEvents.length - 1].SK,
            [HOLD_ITEM_CONSTANTS.HOLD_EVENT_GSI1_KEYS.PK]:
              trimmedEvents[trimmedEvents.length - 1].HOLD_EVENT_GSI1PK,
            [HOLD_ITEM_CONSTANTS.HOLD_EVENT_GSI1_KEYS.SK]:
              trimmedEvents[trimmedEvents.length - 1].HOLD_EVENT_GSI1SK,
          }
        : query.LastEvaluatedKey;

    const nextToken = nextKeySource
      ? this.encodePaginationToken(nextKeySource)
      : undefined;

    return {
      items,
      nextToken,
      hasMore: Boolean(nextToken),
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

    const holdEventItem = buildHoldEventItem(request.hold, request.holdEvent);
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

  async captureHold(request: CaptureHoldRequest): Promise<CaptureHoldResult> {
    const timing = TimingUtils.startTiming(
      OPERATION_NAMES.BANKING?.CAPTURE_HOLD_REPOSITORY ??
        'CaptureHoldRepository'
    );

    const amountMinor = request.hold.amountMinor;

    const payerAccountKey = {
      PK: `${TABLE_PREFIXES.ACCOUNT}${request.payerAccountId}`,
      SK: SORT_KEYS.BALANCE,
    };

    const counterpartyAccountKey = {
      PK: `${TABLE_PREFIXES.ACCOUNT}${request.counterpartyAccountId}`,
      SK: SORT_KEYS.BALANCE,
    };

    const holdPartitionKey = buildHoldPartitionKey(request.hold.holdId);
    const updatedHoldMeta = buildHoldMetaItem(request.hold);
    const holdUpdateExpressions = [
      '#status = :capturedStatus',
      `${HOLD_ITEM_CONSTANTS.GSI1_KEYS.SK} = :gsi1sk`,
      'relatedTransactionId = :relatedTransactionId',
      'counterpartyAccountNumber = :counterpartyAccountNumber',
    ];
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':capturedStatus': request.hold.status,
      ':pendingStatus': 'PENDING',
      ':gsi1sk': updatedHoldMeta.HOLD_GSI1SK,
      ':relatedTransactionId': request.transaction.id,
      ':counterpartyAccountNumber': request.hold.counterpartyAccountNumber,
    };

    const removeExpressions = ['releasedAt', 'releaseReason'];

    const holdUpdateExpression =
      `SET ${holdUpdateExpressions.join(', ')}` +
      (removeExpressions.length > 0
        ? ` REMOVE ${removeExpressions.join(', ')}`
        : '');

    const holdEventItem = buildHoldEventItem(request.hold, request.holdEvent);
    const idempotencyItem = buildHoldIdempotencyItem({
      userId: request.userId,
      idempotencyKey: request.idempotencyKey,
      holdId: request.hold.holdId,
      command: 'CAPTURE',
      createdAt: request.holdEvent.at,
      transactionId: request.transaction.id,
    });

    const transactItems = [
      {
        Update: {
          TableName: this.tableName,
          Key: payerAccountKey,
          UpdateExpression:
            'SET availableBalanceMinor = availableBalanceMinor + :payerAvailableDelta, ledgerBalanceMinor = ledgerBalanceMinor + :payerLedgerDelta, #version = #version + :inc',
          ConditionExpression: `${EXPRESSION_ATTRIBUTE_NAMES.VERSION} = :currentVersion`,
          ExpressionAttributeNames: {
            [EXPRESSION_ATTRIBUTE_NAMES.VERSION]: 'version',
          },
          ExpressionAttributeValues: {
            ':payerAvailableDelta': 0,
            ':payerLedgerDelta': -amountMinor,
            ':inc': 1,
            ':currentVersion': request.payerAccountBalanceVersion,
          },
        },
      },
      {
        Update: {
          TableName: this.tableName,
          Key: counterpartyAccountKey,
          UpdateExpression:
            'SET availableBalanceMinor = availableBalanceMinor + :counterpartyAvailableDelta, ledgerBalanceMinor = ledgerBalanceMinor + :counterpartyLedgerDelta, #version = #version + :inc',
          ConditionExpression: `${EXPRESSION_ATTRIBUTE_NAMES.VERSION} = :currentVersion`,
          ExpressionAttributeNames: {
            [EXPRESSION_ATTRIBUTE_NAMES.VERSION]: 'version',
          },
          ExpressionAttributeValues: {
            ':counterpartyAvailableDelta': amountMinor,
            ':counterpartyLedgerDelta': amountMinor,
            ':inc': 1,
            ':currentVersion': request.counterpartyAccountBalanceVersion,
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
          ConditionExpression:
            '#status = :pendingStatus AND (attribute_not_exists(counterpartyAccountNumber) OR counterpartyAccountNumber = :counterpartyAccountNumber)',
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
      buildTransactionHeaderPutItem(this.tableName, request.transaction),
      ...buildPostingPutItems(this.tableName, request.transaction),
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
        METRIC_NAMES.BANKING?.CAPTURE_HOLD_REPOSITORY_SUCCESS ??
          'CaptureHoldRepositorySuccess',
        METRIC_UNITS.COUNT,
        1
      );
      this.metrics?.addMetric(
        METRIC_NAMES.BANKING?.CAPTURE_HOLD_REPOSITORY_DURATION ??
          'CaptureHoldRepositoryDuration',
        METRIC_UNITS.MILLISECONDS,
        completedTiming.duration ?? 0
      );

      this.logger?.debug('Hold captured successfully in repository', {
        holdId: request.hold.holdId,
        transactionId: request.transaction.id,
        userId: request.userId,
        payerAccountId: request.payerAccountId,
        counterpartyAccountId: request.counterpartyAccountId,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return {
        hold: request.hold,
        transactionId: request.transaction.id,
        created: true,
      };
    } catch (error) {
      const failedTiming = TimingUtils.endTiming(timing);

      this.metrics?.addMetric(
        METRIC_NAMES.BANKING?.CAPTURE_HOLD_REPOSITORY_ERROR ??
          'CaptureHoldRepositoryError',
        METRIC_UNITS.COUNT,
        1
      );

      this.logger?.error('Hold capture transaction failed', {
        holdId: request.hold.holdId,
        transactionId: request.transaction.id,
        userId: request.userId,
        payerAccountId: request.payerAccountId,
        counterpartyAccountId: request.counterpartyAccountId,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...TimingUtils.createTimingMetadata(failedTiming),
      });

      return this.handleCaptureError(error, request);
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
      const record = await this.getHoldIdempotencyRecord(
        request.userId,
        request.idempotencyKey,
        'RESERVE'
      );
      const hold = await this.getHold(record.holdId);
      if (!hold) {
        throw new RepositoryError(
          `hold_idempotency_lookup_${record.holdId}`,
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
      const record = await this.getHoldIdempotencyRecord(
        request.userId,
        request.idempotencyKey,
        'RELEASE'
      );
      const hold = await this.getHold(record.holdId);
      if (!hold) {
        throw new RepositoryError(
          `hold_idempotency_lookup_${record.holdId}`,
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
      const hold = await this.getHold(request.hold.holdId);
      if (hold?.status === 'RELEASED') {
        return { hold, created: false };
      }
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

  private async handleCaptureError(
    error: unknown,
    request: CaptureHoldRequest
  ): Promise<CaptureHoldResult> {
    if (!(error instanceof TransactionCanceledException)) {
      throw new RepositoryError(
        `hold_capture_${request.hold.holdId}`,
        error as Error
      );
    }

    const reasons = error.CancellationReasons ?? [];

    if (reasons[0]?.Code === DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED) {
      const balance = await this.getAccountBalanceItem(request.payerAccountId);
      if (!balance) {
        throw new OptimisticLockError(`hold_capture_${request.hold.holdId}`);
      }

      if (balance.availableBalanceMinor < request.hold.amountMinor) {
        throw new InsufficientFundsError(
          request.hold.amountMinor,
          balance.availableBalanceMinor
        );
      }

      throw new OptimisticLockError(`hold_capture_${request.hold.holdId}`);
    }

    if (reasons[1]?.Code === DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED) {
      throw new OptimisticLockError(`hold_capture_${request.hold.holdId}`);
    }

    if (reasons[2]?.Code === DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED) {
      const hold = await this.getHold(request.hold.holdId);
      if (!hold) {
        throw new OptimisticLockError(`hold_capture_${request.hold.holdId}`);
      }
      if (hold.status === 'CAPTURED') {
        return this.buildCaptureIdempotentResult(request, hold);
      }
      if (
        hold.status === 'PENDING' &&
        hold.counterpartyAccountNumber &&
        request.hold.counterpartyAccountNumber &&
        hold.counterpartyAccountNumber !==
          request.hold.counterpartyAccountNumber
      ) {
        throw new OptimisticLockError(`hold_capture_${request.hold.holdId}`);
      }
      throw new OptimisticLockError(`hold_capture_${request.hold.holdId}`);
    }

    const lastReason = reasons[reasons.length - 1];
    if (lastReason?.Code === DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED) {
      return this.buildCaptureIdempotentResult(request);
    }

    if (
      reasons.some(
        reason => reason.Code === DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
      )
    ) {
      throw new OptimisticLockError(`hold_capture_${request.hold.holdId}`);
    }

    throw new RepositoryError(
      `hold_capture_${request.hold.holdId}`,
      error as Error
    );
  }

  private async buildCaptureIdempotentResult(
    request: CaptureHoldRequest,
    cachedHold?: Hold | null
  ): Promise<CaptureHoldResult> {
    const record = await this.getHoldIdempotencyRecord(
      request.userId,
      request.idempotencyKey,
      'CAPTURE'
    );
    const hold =
      cachedHold ?? (await this.getHold(record.holdId ?? request.hold.holdId));
    if (!hold) {
      throw new RepositoryError(
        `hold_idempotency_lookup_${request.hold.holdId}`,
        new Error('Hold not found after idempotency lookup')
      );
    }

    const transactionId =
      record.transactionId ??
      hold.relatedTransactionId ??
      request.transaction.id;

    if (!transactionId) {
      throw new RepositoryError(
        `hold_idempotency_lookup_${hold.holdId}`,
        new Error('Missing transactionId on idempotent capture replay')
      );
    }

    return { hold, transactionId, created: false };
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

  private async getHoldIdempotencyRecord(
    userId: string,
    idempotencyKey: string,
    command: HoldIdempotencyCommand
  ): Promise<{ holdId: string; transactionId?: string }> {
    const partitionKey = `${TABLE_PREFIXES.USER}${userId}`;
    const keysToTry = [
      buildHoldIdempotencySortKey(command, idempotencyKey),
      buildLegacyHoldIdempotencySortKey(idempotencyKey),
    ];

    for (const sortKey of keysToTry) {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            PK: partitionKey,
            SK: sortKey,
          },
          ProjectionExpression: 'holdId, transactionId, command',
          ConsistentRead: true,
        })
      );

      const record = result.Item as
        | {
            holdId?: string;
            transactionId?: string;
            command?: HoldIdempotencyCommand;
          }
        | undefined;

      if (!record?.holdId) {
        continue;
      }

      if (record.command && record.command !== command) {
        continue;
      }

      return {
        holdId: record.holdId,
        transactionId: record.transactionId,
      };
    }

    throw new RepositoryError(
      `hold_idempotency_lookup_${userId}_${idempotencyKey}`,
      new Error('Hold idempotency record missing holdId')
    );
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
