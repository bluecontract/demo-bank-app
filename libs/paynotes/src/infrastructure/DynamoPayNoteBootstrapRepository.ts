import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type {
  PayNoteBootstrapRecord,
  PayNoteBootstrapRepository,
} from '../application/ports';

const ENTITY_TYPES = {
  BOOTSTRAP: 'PAYNOTE_BOOTSTRAP',
} as const;

const TABLE_PREFIXES = {
  BOOTSTRAP: 'PAYNOTE_BOOTSTRAP#',
} as const;

const SORT_KEYS = {
  META: 'META',
} as const;

type DynamoPayNoteBootstrapRepositoryConfig = {
  tableName: string;
  region: string;
  endpoint?: string;
};

interface PayNoteBootstrapItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.BOOTSTRAP;
  bootstrapSessionId: string;
  userId: string;
  accountNumber: string;
  payerAccountNumber: string;
  payeeAccountNumber?: string;
  createdAt: string;
}

export class DynamoPayNoteBootstrapRepository
  implements PayNoteBootstrapRepository
{
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(config: DynamoPayNoteBootstrapRepositoryConfig) {
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

  private mapItemToRecord(item: PayNoteBootstrapItem): PayNoteBootstrapRecord {
    return {
      bootstrapSessionId: item.bootstrapSessionId,
      userId: item.userId,
      accountNumber: item.accountNumber,
      payerAccountNumber: item.payerAccountNumber,
      payeeAccountNumber: item.payeeAccountNumber,
      createdAt: item.createdAt,
    };
  }

  async getBootstrapBySessionId(
    bootstrapSessionId: string
  ): Promise<PayNoteBootstrapRecord | null> {
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

    return this.mapItemToRecord(response.Item as PayNoteBootstrapItem);
  }

  async saveBootstrap(record: PayNoteBootstrapRecord): Promise<void> {
    const item: PayNoteBootstrapItem = {
      PK: this.buildBootstrapPk(record.bootstrapSessionId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.BOOTSTRAP,
      bootstrapSessionId: record.bootstrapSessionId,
      userId: record.userId,
      accountNumber: record.accountNumber,
      payerAccountNumber: record.payerAccountNumber,
      payeeAccountNumber: record.payeeAccountNumber,
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

export type { PayNoteBootstrapRepository } from '../application/ports';
