import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type {
  PendingBootstrapEventRecord,
  PendingBootstrapEventRepository,
} from '../application/ports';

const ENTITY_TYPES = {
  PENDING_BOOTSTRAP_EVENT: 'PENDING_BOOTSTRAP_EVENT',
} as const;

const TABLE_PREFIXES = {
  PENDING_BOOTSTRAP: 'PAYNOTE_BOOTSTRAP_PENDING#',
} as const;

const SORT_KEY_PREFIXES = {
  EVENT: 'EVENT#',
} as const;

type DynamoPendingBootstrapEventRepositoryConfig = {
  tableName: string;
  region: string;
  endpoint?: string;
};

interface PendingBootstrapEventItem {
  PK: string;
  SK: string;
  entityType: typeof ENTITY_TYPES.PENDING_BOOTSTRAP_EVENT;
  bootstrapSessionId: string;
  eventId: string;
  createdAt: string;
  ttl?: number;
}

export class DynamoPendingBootstrapEventRepository
  implements PendingBootstrapEventRepository
{
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(config: DynamoPendingBootstrapEventRepositoryConfig) {
    this.tableName = config.tableName;
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  private buildPendingPk(bootstrapSessionId: string) {
    return `${TABLE_PREFIXES.PENDING_BOOTSTRAP}${bootstrapSessionId}`;
  }

  private buildEventSk(eventId: string) {
    return `${SORT_KEY_PREFIXES.EVENT}${eventId}`;
  }

  async addPending(record: PendingBootstrapEventRecord): Promise<void> {
    const item: PendingBootstrapEventItem = {
      PK: this.buildPendingPk(record.bootstrapSessionId),
      SK: this.buildEventSk(record.eventId),
      entityType: ENTITY_TYPES.PENDING_BOOTSTRAP_EVENT,
      bootstrapSessionId: record.bootstrapSessionId,
      eventId: record.eventId,
      createdAt: record.createdAt,
      ttl: record.ttl,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression:
          'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      })
    );
  }

  async listPending(
    bootstrapSessionId: string
  ): Promise<PendingBootstrapEventRecord[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :eventPrefix)',
        ExpressionAttributeValues: {
          ':pk': this.buildPendingPk(bootstrapSessionId),
          ':eventPrefix': SORT_KEY_PREFIXES.EVENT,
        },
        ConsistentRead: true,
      })
    );

    const items = (response.Items ?? []) as PendingBootstrapEventItem[];
    return items.map(item => ({
      bootstrapSessionId: item.bootstrapSessionId,
      eventId: item.eventId,
      createdAt: item.createdAt,
      ttl: item.ttl,
    }));
  }

  async deletePending(input: {
    bootstrapSessionId: string;
    eventId: string;
  }): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildPendingPk(input.bootstrapSessionId),
          SK: this.buildEventSk(input.eventId),
        },
      })
    );
  }
}

export type { PendingBootstrapEventRepository } from '../application/ports';
