import {
  DynamoDBClient,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  CardRepository,
  CardSummary,
} from '../application/CardRepository';
import type { Card } from '../domain/entities/Card';
import type { PaginationOptions, PaginatedResult } from '../domain/types';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import { CONDITION_EXPRESSIONS, DYNAMO_ERROR_CODES } from './dynamo/constants';
import {
  buildCardAccountIndexItem,
  buildCardMetaItem,
  buildCardPanLookupItem,
  buildCardPartitionKey,
  buildCardPanPartitionKey,
  mapCardAccountItemToSummary,
  mapCardMetaItemToCard,
  CARD_ITEM_CONSTANTS,
  type CardMetaItem,
  type CardAccountIndexItem,
  type CardPanLookupItem,
} from './dynamo/cards/items';
import { RepositoryError } from './repositoryErrors';
import { CardPanCollisionError } from '../application/errors';

export interface DynamoCardRepositoryConfig {
  tableName: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export class DynamoCardRepository implements CardRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: DynamoCardRepositoryConfig) {
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...(config.credentials && { credentials: config.credentials }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = config.tableName;
  }

  async createCard(card: Card): Promise<void> {
    const ttl = card.isTest
      ? Math.floor(Date.now() / 1000) + 24 * 60 * 60
      : undefined;

    const metaItem = buildCardMetaItem(card, { ttl });
    const accountIndexItem = buildCardAccountIndexItem(card, { ttl });
    const panLookupItem = buildCardPanLookupItem(card, { ttl });

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: metaItem,
                ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: panLookupItem,
                ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: accountIndexItem,
                ConditionExpression: CONDITION_EXPRESSIONS.ATTRIBUTE_NOT_EXISTS,
              },
            },
          ],
        })
      );
    } catch (error) {
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.[1]?.Code ===
          DYNAMO_ERROR_CODES.CONDITIONAL_CHECK_FAILED
      ) {
        throw new CardPanCollisionError(card.panHash, error);
      }

      throw new RepositoryError(`create_card_${card.cardId}`, error as Error);
    }
  }

  async getCardById(cardId: Card['cardId']): Promise<Card | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: buildCardPartitionKey(cardId),
          SK: CARD_ITEM_CONSTANTS.SORT_KEYS.META,
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    if (!this.isValidCardMetaItem(result.Item)) {
      throw new RepositoryError(
        `get_card_${cardId}`,
        new Error('Invalid card')
      );
    }

    return mapCardMetaItemToCard(result.Item);
  }

  async getCardByPanHash(panHash: Card['panHash']): Promise<Card | null> {
    const lookup = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: buildCardPanPartitionKey(panHash),
          SK: CARD_ITEM_CONSTANTS.SORT_KEYS.LOOKUP,
        },
      })
    );

    const lookupItem = lookup.Item as CardPanLookupItem | undefined;
    if (!lookupItem) {
      return null;
    }

    const card = await this.getCardById(lookupItem.cardId);
    if (!card) {
      return null;
    }

    return card;
  }

  async listCardsByAccountId(
    accountId: Card['accountId'],
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<CardSummary>> {
    const limit =
      typeof options.limit === 'number' && options.limit > 0
        ? Math.floor(options.limit)
        : undefined;

    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `${CARD_ITEM_CONSTANTS.TABLE_PREFIXES.ACCOUNT}${accountId}`,
        ':sk': CARD_ITEM_CONSTANTS.ACCOUNT_CARD_PREFIX,
      },
      ScanIndexForward: false,
      ...(limit ? { Limit: limit } : {}),
      ...(options.nextToken
        ? { ExclusiveStartKey: JSON.parse(options.nextToken) }
        : {}),
    });

    const result = await this.client.send(command);
    const items = (result.Items ?? []) as CardAccountIndexItem[];
    items.forEach(item => {
      if (!this.isValidCardAccountIndexItem(item)) {
        throw new RepositoryError(
          `list_cards_${accountId}`,
          new Error('Invalid card index item')
        );
      }
    });

    return {
      items: items.map(mapCardAccountItemToSummary),
      nextToken: result.LastEvaluatedKey
        ? JSON.stringify(result.LastEvaluatedKey)
        : undefined,
      hasMore: !!result.LastEvaluatedKey,
    };
  }

  private isValidCardMetaItem(item: unknown): item is CardMetaItem {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const record = item as Record<string, unknown>;
    return (
      typeof record.cardId === 'string' &&
      typeof record.accountId === 'string' &&
      typeof record.accountNumber === 'string' &&
      typeof record.ownerUserId === 'string' &&
      typeof record.cardholderName === 'string' &&
      typeof record.panLast4 === 'string' &&
      typeof record.panHash === 'string' &&
      typeof record.cvcHash === 'string' &&
      typeof record.expiryMonth === 'number' &&
      typeof record.expiryYear === 'number' &&
      typeof record.status === 'string' &&
      typeof record.createdAt === 'string' &&
      typeof record.updatedAt === 'string'
    );
  }

  private isValidCardAccountIndexItem(
    item: unknown
  ): item is CardAccountIndexItem {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const record = item as Record<string, unknown>;
    return (
      typeof record.cardId === 'string' &&
      typeof record.accountId === 'string' &&
      typeof record.accountNumber === 'string' &&
      typeof record.cardholderName === 'string' &&
      typeof record.panLast4 === 'string' &&
      typeof record.expiryMonth === 'number' &&
      typeof record.expiryYear === 'number' &&
      typeof record.status === 'string' &&
      typeof record.createdAt === 'string' &&
      typeof record.updatedAt === 'string'
    );
  }
}
