import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type {
  MerchantDirectoryEntry,
  MerchantDirectoryRepository,
} from '../application/ports';
import { AuthRepositoryError, MerchantDirectoryOwnershipError } from './errors';

const ENTITY_TYPES = {
  MERCHANT_PROFILE: 'MERCHANT_PROFILE',
} as const;

const TABLE_PREFIXES = {
  MERCHANT: 'MERCHANT#',
} as const;

const SORT_KEYS = {
  PROFILE: 'PROFILE',
} as const;

export interface DynamoMerchantDirectoryRepositoryConfig {
  tableName: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

interface MerchantDirectoryItem {
  PK: string;
  SK: typeof SORT_KEYS.PROFILE;
  entityType: typeof ENTITY_TYPES.MERCHANT_PROFILE;
  merchantId: string;
  name: string;
  logoUrl?: string;
  ownerUserId: string;
  updatedAt: string;
}

const isConditionalCheckFailedException = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (
    'name' in error &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  );
};

export class DynamoMerchantDirectoryRepository
  implements MerchantDirectoryRepository
{
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: DynamoMerchantDirectoryRepositoryConfig) {
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

  private buildMerchantPk(merchantId: string) {
    return `${TABLE_PREFIXES.MERCHANT}${merchantId}`;
  }

  async upsertMerchantProfile(entry: MerchantDirectoryEntry): Promise<void> {
    const item: MerchantDirectoryItem = {
      PK: this.buildMerchantPk(entry.merchantId),
      SK: SORT_KEYS.PROFILE,
      entityType: ENTITY_TYPES.MERCHANT_PROFILE,
      merchantId: entry.merchantId,
      name: entry.name,
      logoUrl: entry.logoUrl,
      ownerUserId: entry.ownerUserId,
      updatedAt: entry.updatedAt,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );
      return;
    } catch (error: unknown) {
      if (!isConditionalCheckFailedException(error)) {
        throw new AuthRepositoryError(
          'upsert merchant profile',
          error instanceof Error ? error : undefined
        );
      }
    }

    const updateExpressions = ['#name = :name', '#updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = {
      '#name': 'name',
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, string> = {
      ':name': entry.name,
      ':updatedAt': entry.updatedAt,
      ':ownerUserId': entry.ownerUserId,
    };

    if (entry.logoUrl !== undefined) {
      updateExpressions.push('#logoUrl = :logoUrl');
      expressionAttributeNames['#logoUrl'] = 'logoUrl';
      expressionAttributeValues[':logoUrl'] = entry.logoUrl;
    }

    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: item.PK,
            SK: SORT_KEYS.PROFILE,
          },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ConditionExpression: 'ownerUserId = :ownerUserId',
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );
    } catch (error: unknown) {
      if (isConditionalCheckFailedException(error)) {
        throw new MerchantDirectoryOwnershipError(entry.merchantId);
      }
      throw new AuthRepositoryError(
        'upsert merchant profile',
        error instanceof Error ? error : undefined
      );
    }
  }

  async getMerchantsByIds(
    merchantIds: string[]
  ): Promise<MerchantDirectoryEntry[]> {
    const uniqueIds = Array.from(
      new Set(merchantIds.map(id => id.trim()).filter(Boolean))
    );

    if (!uniqueIds.length) {
      return [];
    }

    const keys = uniqueIds.map(merchantId => ({
      PK: this.buildMerchantPk(merchantId),
      SK: SORT_KEYS.PROFILE,
    }));

    const response = await this.client.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: keys,
          },
        },
      })
    );

    const items = (response.Responses?.[this.tableName] ??
      []) as MerchantDirectoryItem[];

    return items.map(item => ({
      merchantId: item.merchantId,
      name: item.name,
      logoUrl: item.logoUrl,
      ownerUserId: item.ownerUserId,
      updatedAt: item.updatedAt,
    }));
  }
}

export type { MerchantDirectoryRepository } from '../application/ports';
