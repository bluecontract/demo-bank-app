import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type { PayNoteRecord, PayNoteRepository } from '../application/ports';

const ENTITY_TYPES = {
  PAYNOTE: 'PAYNOTE',
  SESSION: 'PAYNOTE_SESSION',
  EVENT: 'PAYNOTE_EVENT',
} as const;

const TABLE_PREFIXES = {
  PAYNOTE: 'PAYNOTE#',
  SESSION: 'PAYNOTE_SESSION#',
  EVENT: 'PAYNOTE_EVENT#',
} as const;

const SORT_KEYS = {
  META: 'META',
} as const;

type DynamoPayNoteRepositoryConfig = {
  tableName: string;
  region: string;
  endpoint?: string;
};

interface PayNoteItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.PAYNOTE;
  payNoteDocumentId: string;
  sessionIds?: string[];
  deliveryId?: string;
  accountNumber?: string;
  userId?: string;
  holdId?: string;
  transactionId?: string;
  lastCaptureLockEventId?: string;
  lastCaptureUnlockEventId?: string;
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
  document?: Record<string, unknown>;
  transactionRequest?: unknown;
  triggerEvent?: unknown;
  createdAt: string;
  updatedAt: string;
}

interface PayNoteSessionItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.SESSION;
  sessionId: string;
  payNoteDocumentId: string;
  createdAt: string;
}

interface PayNoteEventItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.EVENT;
  eventId: string;
  createdAt: string;
  ttl?: number;
}

export class DynamoPayNoteRepository implements PayNoteRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(config: DynamoPayNoteRepositoryConfig) {
    this.tableName = config.tableName;
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  private buildPayNotePk(documentId: string) {
    return `${TABLE_PREFIXES.PAYNOTE}${documentId}`;
  }

  private buildSessionPk(sessionId: string) {
    return `${TABLE_PREFIXES.SESSION}${sessionId}`;
  }

  private buildEventPk(eventId: string) {
    return `${TABLE_PREFIXES.EVENT}${eventId}`;
  }

  private mapItemToRecord(item: PayNoteItem): PayNoteRecord {
    return {
      payNoteDocumentId: item.payNoteDocumentId,
      sessionIds: item.sessionIds,
      deliveryId: item.deliveryId,
      accountNumber: item.accountNumber,
      userId: item.userId,
      holdId: item.holdId,
      transactionId: item.transactionId,
      lastCaptureLockEventId: item.lastCaptureLockEventId,
      lastCaptureUnlockEventId: item.lastCaptureUnlockEventId,
      payerAccountNumber: item.payerAccountNumber,
      payeeAccountNumber: item.payeeAccountNumber,
      document: item.document,
      transactionRequest: item.transactionRequest,
      triggerEvent: item.triggerEvent,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async getPayNote(documentId: string): Promise<PayNoteRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildPayNotePk(documentId),
          SK: SORT_KEYS.META,
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    return this.mapItemToRecord(response.Item as PayNoteItem);
  }

  async getPayNoteBySessionId(
    sessionId: string
  ): Promise<PayNoteRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildSessionPk(sessionId),
          SK: SORT_KEYS.META,
        },
      })
    );

    const documentId = (response.Item as PayNoteSessionItem | undefined)
      ?.payNoteDocumentId;
    if (!documentId) {
      return null;
    }

    return this.getPayNote(documentId);
  }

  async savePayNote(record: PayNoteRecord): Promise<void> {
    const item: PayNoteItem = {
      PK: this.buildPayNotePk(record.payNoteDocumentId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.PAYNOTE,
      payNoteDocumentId: record.payNoteDocumentId,
      sessionIds: record.sessionIds,
      deliveryId: record.deliveryId,
      accountNumber: record.accountNumber,
      userId: record.userId,
      holdId: record.holdId,
      transactionId: record.transactionId,
      lastCaptureLockEventId: record.lastCaptureLockEventId,
      lastCaptureUnlockEventId: record.lastCaptureUnlockEventId,
      payerAccountNumber: record.payerAccountNumber,
      payeeAccountNumber: record.payeeAccountNumber,
      document: record.document,
      transactionRequest: record.transactionRequest,
      triggerEvent: record.triggerEvent,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    if (!record.sessionIds?.length) {
      return;
    }

    const writes = record.sessionIds.map(sessionId => {
      const sessionItem: PayNoteSessionItem = {
        PK: this.buildSessionPk(sessionId),
        SK: SORT_KEYS.META,
        entityType: ENTITY_TYPES.SESSION,
        sessionId,
        payNoteDocumentId: record.payNoteDocumentId,
        createdAt: record.createdAt,
      };

      return this.client.send(
        new PutCommand({ TableName: this.tableName, Item: sessionItem })
      );
    });

    await Promise.all(writes);
  }

  async markEventProcessed(eventId: string): Promise<boolean> {
    const createdAt = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
    const item: PayNoteEventItem = {
      PK: this.buildEventPk(eventId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.EVENT,
      eventId,
      createdAt,
      ttl,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: {
            '#pk': 'PK',
          },
        })
      );
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        (error as { name?: string }).name === 'ConditionalCheckFailedException'
      ) {
        return false;
      }
      throw error;
    }
  }
}

export type { PayNoteRepository } from '../application/ports';
