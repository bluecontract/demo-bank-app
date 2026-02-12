import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type {
  BootstrapContextRecord,
  BootstrapContextRepository,
} from '../application/ports';

const ENTITY_TYPES = {
  BOOTSTRAP_CONTEXT: 'BOOTSTRAP_CONTEXT',
} as const;

const TABLE_PREFIXES = {
  BOOTSTRAP: 'BOOTSTRAP#',
} as const;

const SORT_KEYS = {
  META: 'META',
} as const;

type DynamoBootstrapContextRepositoryConfig = {
  tableName: string;
  region: string;
  endpoint?: string;
};

interface BootstrapContextItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.BOOTSTRAP_CONTEXT;
  bootstrapSessionId: string;
  merchantId?: string;
  accountNumber?: string;
  userId?: string;
  holdId?: string;
  transactionId?: string;
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
  customerChannelKey?: string;
  requestingSessionId?: string;
  requestId?: string;
  createdAt: string;
}

export class DynamoBootstrapContextRepository
  implements BootstrapContextRepository
{
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(config: DynamoBootstrapContextRepositoryConfig) {
    this.tableName = config.tableName;
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  private buildBootstrapPk(bootstrapSessionId: string) {
    return `${TABLE_PREFIXES.BOOTSTRAP}${bootstrapSessionId}`;
  }

  async getContextBySessionId(
    bootstrapSessionId: string
  ): Promise<BootstrapContextRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildBootstrapPk(bootstrapSessionId),
          SK: SORT_KEYS.META,
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = response.Item as BootstrapContextItem;
    return {
      bootstrapSessionId: item.bootstrapSessionId,
      ...(item.merchantId ? { merchantId: item.merchantId } : {}),
      accountNumber: item.accountNumber,
      userId: item.userId,
      holdId: item.holdId,
      transactionId: item.transactionId,
      payerAccountNumber: item.payerAccountNumber,
      payeeAccountNumber: item.payeeAccountNumber,
      customerChannelKey: item.customerChannelKey,
      requestingSessionId: item.requestingSessionId,
      requestId: item.requestId,
      createdAt: item.createdAt,
    };
  }

  async saveContext(record: BootstrapContextRecord): Promise<void> {
    const item: BootstrapContextItem = {
      PK: this.buildBootstrapPk(record.bootstrapSessionId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.BOOTSTRAP_CONTEXT,
      bootstrapSessionId: record.bootstrapSessionId,
      ...(record.merchantId ? { merchantId: record.merchantId } : {}),
      ...(record.accountNumber ? { accountNumber: record.accountNumber } : {}),
      ...(record.userId ? { userId: record.userId } : {}),
      ...(record.holdId ? { holdId: record.holdId } : {}),
      ...(record.transactionId ? { transactionId: record.transactionId } : {}),
      ...(record.payerAccountNumber
        ? { payerAccountNumber: record.payerAccountNumber }
        : {}),
      ...(record.payeeAccountNumber
        ? { payeeAccountNumber: record.payeeAccountNumber }
        : {}),
      ...(record.customerChannelKey
        ? { customerChannelKey: record.customerChannelKey }
        : {}),
      ...(record.requestingSessionId
        ? { requestingSessionId: record.requestingSessionId }
        : {}),
      ...(record.requestId ? { requestId: record.requestId } : {}),
      createdAt: record.createdAt,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }
}

export type { BootstrapContextRepository } from '../application/ports';
