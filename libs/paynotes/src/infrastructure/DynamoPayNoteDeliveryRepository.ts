import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type {
  PayNoteDeliveryRepository,
  PayNoteDeliveryRecord,
  PayNoteDeliverySummary,
} from '../application/ports';
import type { CardTransactionDetails } from '@demo-bank-app/banking';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import {
  getDeliveryNameFromDocument,
  getPayNoteSummaryFromDocument,
} from '../application/payNoteDelivery/blueUtils';

const ENTITY_TYPES = {
  DELIVERY: 'PAYNOTE_DELIVERY',
  SESSION: 'PAYNOTE_DELIVERY_SESSION',
  CARD_TXN: 'PAYNOTE_DELIVERY_CARD_TXN',
  DOCUMENT: 'PAYNOTE_DELIVERY_DOCUMENT',
  PAYNOTE_DOCUMENT: 'PAYNOTE_DELIVERY_PAYNOTE_DOCUMENT',
  BOOTSTRAP: 'PAYNOTE_DELIVERY_BOOTSTRAP',
  EVENT: 'PAYNOTE_DELIVERY_EVENT',
  USER: 'PAYNOTE_DELIVERY_USER',
} as const;

const TABLE_PREFIXES = {
  DELIVERY: 'PAYNOTE_DELIVERY#',
  SESSION: 'PAYNOTE_DELIVERY_SESSION#',
  CARD_TXN: 'PAYNOTE_DELIVERY_CARD_TXN#',
  DOCUMENT: 'PAYNOTE_DELIVERY_DOCUMENT#',
  PAYNOTE_DOCUMENT: 'PAYNOTE_DELIVERY_PAYNOTE_DOCUMENT#',
  BOOTSTRAP: 'PAYNOTE_DELIVERY_BOOTSTRAP#',
  EVENT: 'PAYNOTE_DELIVERY_EVENT#',
  USER: 'USER#',
} as const;

const SORT_KEYS = {
  META: 'META',
} as const;

const USER_SORT_KEY_PREFIX = 'PAYNOTE_DELIVERY#';

type DynamoPayNoteDeliveryRepositoryConfig = {
  tableName: string;
  region: string;
  endpoint?: string;
};

interface PayNoteDeliveryItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.DELIVERY;
  deliveryId: string;
  createdAt: string;
  updatedAt: string;
  deliveryDocumentId?: string;
  deliverySessionId?: string;
  deliverySessionIds?: string[];
  synchronySessionId?: string;
  cardTransactionDetails?: CardTransactionDetails;
  cardTransactionDetailsKey?: string;
  accountNumber?: string;
  userId?: string;
  holdId?: string;
  transactionId?: string;
  transactionIdentificationStatus?: string;
  clientDecisionStatus?: string;
  deliveryStatus?: string;
  deliveryDocument?: Record<string, unknown>;
  deliveryUpdatedAt?: string;
  payNoteDocumentId?: string;
  payNoteSessionIds?: string[];
  payNoteBootstrapSessionId?: string;
  payNoteDocument?: Record<string, unknown>;
  payNoteUpdatedAt?: string;
  identificationReportedAt?: string;
  decisionRecordedAt?: string;
  payNoteBootstrapRequestedAt?: string;
}

interface PayNoteDeliverySessionItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.SESSION;
  sessionId: string;
  deliveryId: string;
  createdAt: string;
}

interface PayNoteDeliveryCardTransactionItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.CARD_TXN;
  cardTransactionDetailsKey: string;
  deliveryId: string;
  createdAt: string;
}

interface PayNoteDeliveryDocumentItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.DOCUMENT;
  documentId: string;
  deliveryId: string;
  createdAt: string;
}

interface PayNoteDeliveryPayNoteDocumentItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.PAYNOTE_DOCUMENT;
  payNoteDocumentId: string;
  deliveryId: string;
  createdAt: string;
}

interface PayNoteDeliveryBootstrapItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.BOOTSTRAP;
  bootstrapSessionId: string;
  deliveryId: string;
  createdAt: string;
}

interface PayNoteDeliveryEventItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.EVENT;
  eventId: string;
  createdAt: string;
  ttl: number;
}

interface PayNoteDeliveryUserItem {
  PK: string;
  SK: string;
  entityType: typeof ENTITY_TYPES.USER;
  deliveryId: string;
  createdAt: string;
  updatedAt: string;
}

export class DynamoPayNoteDeliveryRepository
  implements PayNoteDeliveryRepository
{
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(config: DynamoPayNoteDeliveryRepositoryConfig) {
    this.tableName = config.tableName;
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  private buildDeliveryPk(deliveryId: string) {
    return `${TABLE_PREFIXES.DELIVERY}${deliveryId}`;
  }

  private buildSessionPk(sessionId: string) {
    return `${TABLE_PREFIXES.SESSION}${sessionId}`;
  }

  private buildCardTransactionPk(cardTransactionDetailsKey: string) {
    return `${TABLE_PREFIXES.CARD_TXN}${cardTransactionDetailsKey}`;
  }

  private buildDeliveryDocumentPk(documentId: string) {
    return `${TABLE_PREFIXES.DOCUMENT}${documentId}`;
  }

  private buildPayNoteDocumentPk(payNoteDocumentId: string) {
    return `${TABLE_PREFIXES.PAYNOTE_DOCUMENT}${payNoteDocumentId}`;
  }

  private buildBootstrapPk(bootstrapSessionId: string) {
    return `${TABLE_PREFIXES.BOOTSTRAP}${bootstrapSessionId}`;
  }

  private buildEventPk(eventId: string) {
    return `${TABLE_PREFIXES.EVENT}${eventId}`;
  }

  private buildUserPk(userId: string) {
    return `${TABLE_PREFIXES.USER}${userId}`;
  }

  private buildUserSk(deliveryId: string, createdAt: string) {
    return `${USER_SORT_KEY_PREFIX}${createdAt}#${deliveryId}`;
  }

  private mapItemToRecord(item: PayNoteDeliveryItem): PayNoteDeliveryRecord {
    return {
      deliveryId: item.deliveryId,
      deliveryDocumentId: item.deliveryDocumentId,
      deliverySessionId: item.deliverySessionId,
      deliverySessionIds: item.deliverySessionIds,
      synchronySessionId: item.synchronySessionId,
      cardTransactionDetails: item.cardTransactionDetails,
      cardTransactionDetailsKey: item.cardTransactionDetailsKey,
      accountNumber: item.accountNumber,
      userId: item.userId,
      holdId: item.holdId,
      transactionId: item.transactionId,
      transactionIdentificationStatus: item.transactionIdentificationStatus,
      clientDecisionStatus: item.clientDecisionStatus,
      deliveryStatus: item.deliveryStatus,
      deliveryDocument: item.deliveryDocument,
      deliveryUpdatedAt: item.deliveryUpdatedAt,
      payNoteDocumentId: item.payNoteDocumentId,
      payNoteSessionIds: item.payNoteSessionIds,
      payNoteBootstrapSessionId: item.payNoteBootstrapSessionId,
      payNoteDocument: item.payNoteDocument,
      payNoteUpdatedAt: item.payNoteUpdatedAt,
      identificationReportedAt: item.identificationReportedAt,
      decisionRecordedAt: item.decisionRecordedAt,
      payNoteBootstrapRequestedAt: item.payNoteBootstrapRequestedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async markEventProcessed(eventId: string): Promise<boolean> {
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + 7 * 24 * 60 * 60;

    const item: PayNoteDeliveryEventItem = {
      PK: this.buildEventPk(eventId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.EVENT,
      eventId,
      createdAt: now.toISOString(),
      ttl,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        return false;
      }
      throw error;
    }
  }

  async getDelivery(deliveryId: string): Promise<PayNoteDeliveryRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildDeliveryPk(deliveryId),
          SK: SORT_KEYS.META,
        },
      })
    );

    if (!response.Item) {
      return null;
    }

    return this.mapItemToRecord(response.Item as PayNoteDeliveryItem);
  }

  async getDeliveryByDocumentId(
    documentId: string
  ): Promise<PayNoteDeliveryRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildDeliveryDocumentPk(documentId),
          SK: SORT_KEYS.META,
        },
      })
    );

    const deliveryId = (
      response.Item as PayNoteDeliveryDocumentItem | undefined
    )?.deliveryId;
    if (!deliveryId) {
      return null;
    }

    return this.getDelivery(deliveryId);
  }

  async getDeliveryBySessionId(
    sessionId: string
  ): Promise<PayNoteDeliveryRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildSessionPk(sessionId),
          SK: SORT_KEYS.META,
        },
      })
    );

    const deliveryId = (response.Item as PayNoteDeliverySessionItem | undefined)
      ?.deliveryId;
    if (!deliveryId) {
      return null;
    }

    return this.getDelivery(deliveryId);
  }

  async getDeliveryByBootstrapSessionId(
    bootstrapSessionId: string
  ): Promise<PayNoteDeliveryRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildBootstrapPk(bootstrapSessionId),
          SK: SORT_KEYS.META,
        },
      })
    );

    const deliveryId = (
      response.Item as PayNoteDeliveryBootstrapItem | undefined
    )?.deliveryId;
    if (!deliveryId) {
      return null;
    }

    return this.getDelivery(deliveryId);
  }

  async getDeliveryByPayNoteDocumentId(
    payNoteDocumentId: string
  ): Promise<PayNoteDeliveryRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildPayNoteDocumentPk(payNoteDocumentId),
          SK: SORT_KEYS.META,
        },
      })
    );

    const deliveryId = (
      response.Item as PayNoteDeliveryPayNoteDocumentItem | undefined
    )?.deliveryId;
    if (!deliveryId) {
      return null;
    }

    return this.getDelivery(deliveryId);
  }

  async getDeliveryByCardTransactionDetails(
    details: CardTransactionDetails
  ): Promise<PayNoteDeliveryRecord | null> {
    const key = buildCardTransactionDetailsKey(details);
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildCardTransactionPk(key),
          SK: SORT_KEYS.META,
        },
      })
    );

    const deliveryId = (
      response.Item as PayNoteDeliveryCardTransactionItem | undefined
    )?.deliveryId;
    if (!deliveryId) {
      return null;
    }

    return this.getDelivery(deliveryId);
  }

  async saveDelivery(record: PayNoteDeliveryRecord): Promise<void> {
    const item: PayNoteDeliveryItem = {
      PK: this.buildDeliveryPk(record.deliveryId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.DELIVERY,
      deliveryId: record.deliveryId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.deliveryDocumentId
        ? { deliveryDocumentId: record.deliveryDocumentId }
        : {}),
      ...(record.deliverySessionId
        ? { deliverySessionId: record.deliverySessionId }
        : {}),
      ...(record.deliverySessionIds
        ? { deliverySessionIds: record.deliverySessionIds }
        : {}),
      ...(record.synchronySessionId
        ? { synchronySessionId: record.synchronySessionId }
        : {}),
      ...(record.cardTransactionDetails
        ? { cardTransactionDetails: record.cardTransactionDetails }
        : {}),
      ...(record.cardTransactionDetailsKey
        ? { cardTransactionDetailsKey: record.cardTransactionDetailsKey }
        : {}),
      ...(record.accountNumber ? { accountNumber: record.accountNumber } : {}),
      ...(record.userId ? { userId: record.userId } : {}),
      ...(record.holdId ? { holdId: record.holdId } : {}),
      ...(record.transactionId ? { transactionId: record.transactionId } : {}),
      ...(record.transactionIdentificationStatus
        ? {
            transactionIdentificationStatus:
              record.transactionIdentificationStatus,
          }
        : {}),
      ...(record.clientDecisionStatus
        ? { clientDecisionStatus: record.clientDecisionStatus }
        : {}),
      ...(record.deliveryStatus
        ? { deliveryStatus: record.deliveryStatus }
        : {}),
      ...(record.deliveryDocument
        ? { deliveryDocument: record.deliveryDocument }
        : {}),
      ...(record.deliveryUpdatedAt
        ? { deliveryUpdatedAt: record.deliveryUpdatedAt }
        : {}),
      ...(record.payNoteDocumentId
        ? { payNoteDocumentId: record.payNoteDocumentId }
        : {}),
      ...(record.payNoteSessionIds
        ? { payNoteSessionIds: record.payNoteSessionIds }
        : {}),
      ...(record.payNoteBootstrapSessionId
        ? { payNoteBootstrapSessionId: record.payNoteBootstrapSessionId }
        : {}),
      ...(record.payNoteDocument
        ? { payNoteDocument: record.payNoteDocument }
        : {}),
      ...(record.payNoteUpdatedAt
        ? { payNoteUpdatedAt: record.payNoteUpdatedAt }
        : {}),
      ...(record.identificationReportedAt
        ? { identificationReportedAt: record.identificationReportedAt }
        : {}),
      ...(record.decisionRecordedAt
        ? { decisionRecordedAt: record.decisionRecordedAt }
        : {}),
      ...(record.payNoteBootstrapRequestedAt
        ? { payNoteBootstrapRequestedAt: record.payNoteBootstrapRequestedAt }
        : {}),
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    const now = new Date().toISOString();
    const writes: Array<Promise<unknown>> = [];

    if (record.deliverySessionIds?.length) {
      record.deliverySessionIds.forEach(sessionId => {
        const sessionItem: PayNoteDeliverySessionItem = {
          PK: this.buildSessionPk(sessionId),
          SK: SORT_KEYS.META,
          entityType: ENTITY_TYPES.SESSION,
          sessionId,
          deliveryId: record.deliveryId,
          createdAt: record.createdAt,
        };
        writes.push(
          this.client.send(
            new PutCommand({ TableName: this.tableName, Item: sessionItem })
          )
        );
      });
    }

    if (record.cardTransactionDetailsKey) {
      const cardItem: PayNoteDeliveryCardTransactionItem = {
        PK: this.buildCardTransactionPk(record.cardTransactionDetailsKey),
        SK: SORT_KEYS.META,
        entityType: ENTITY_TYPES.CARD_TXN,
        cardTransactionDetailsKey: record.cardTransactionDetailsKey,
        deliveryId: record.deliveryId,
        createdAt: record.createdAt,
      };
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: cardItem })
        )
      );
    }

    if (record.deliveryDocumentId) {
      const documentItem: PayNoteDeliveryDocumentItem = {
        PK: this.buildDeliveryDocumentPk(record.deliveryDocumentId),
        SK: SORT_KEYS.META,
        entityType: ENTITY_TYPES.DOCUMENT,
        documentId: record.deliveryDocumentId,
        deliveryId: record.deliveryId,
        createdAt: record.createdAt,
      };
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: documentItem })
        )
      );
    }

    if (record.payNoteDocumentId) {
      const payNoteItem: PayNoteDeliveryPayNoteDocumentItem = {
        PK: this.buildPayNoteDocumentPk(record.payNoteDocumentId),
        SK: SORT_KEYS.META,
        entityType: ENTITY_TYPES.PAYNOTE_DOCUMENT,
        payNoteDocumentId: record.payNoteDocumentId,
        deliveryId: record.deliveryId,
        createdAt: record.createdAt,
      };
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: payNoteItem })
        )
      );
    }

    if (record.payNoteBootstrapSessionId) {
      const bootstrapItem: PayNoteDeliveryBootstrapItem = {
        PK: this.buildBootstrapPk(record.payNoteBootstrapSessionId),
        SK: SORT_KEYS.META,
        entityType: ENTITY_TYPES.BOOTSTRAP,
        bootstrapSessionId: record.payNoteBootstrapSessionId,
        deliveryId: record.deliveryId,
        createdAt: record.createdAt,
      };
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: bootstrapItem })
        )
      );
    }

    if (record.userId) {
      const userItem: PayNoteDeliveryUserItem = {
        PK: this.buildUserPk(record.userId),
        SK: this.buildUserSk(record.deliveryId, record.createdAt),
        entityType: ENTITY_TYPES.USER,
        deliveryId: record.deliveryId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt ?? now,
      };
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: userItem })
        )
      );
    }

    if (writes.length) {
      await Promise.all(writes);
    }
  }

  async listDeliveriesByUserId(
    userId: string
  ): Promise<PayNoteDeliverySummary[]> {
    const query = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'PK',
          '#sk': 'SK',
        },
        ExpressionAttributeValues: {
          ':pk': this.buildUserPk(userId),
          ':skPrefix': USER_SORT_KEY_PREFIX,
        },
        ScanIndexForward: false,
      })
    );

    const items = (query.Items ?? []) as PayNoteDeliveryUserItem[];
    const deliveries = await Promise.all(
      items.map(item => this.getDelivery(item.deliveryId))
    );

    return deliveries
      .filter((record): record is PayNoteDeliveryRecord => record !== null)
      .map(record => {
        const deliveryDocument = record.deliveryDocument as
          | {
              payNoteBootstrapRequest?: { document?: unknown };
              payNote?: unknown;
            }
          | undefined;
        const payNotePayload =
          deliveryDocument?.payNoteBootstrapRequest?.document ??
          deliveryDocument?.payNote;
        const payNoteSummary = getPayNoteSummaryFromDocument(payNotePayload);
        const deliveryName = record.deliveryDocument
          ? getDeliveryNameFromDocument(record.deliveryDocument)
          : undefined;

        return {
          deliveryId: record.deliveryId,
          deliverySessionId: record.deliverySessionId,
          name: payNoteSummary.name ?? deliveryName,
          amountMinor: payNoteSummary.amountMinor,
          currency: payNoteSummary.currency,
          deliveryStatus: record.deliveryStatus,
          transactionIdentificationStatus:
            record.transactionIdentificationStatus,
          clientDecisionStatus: record.clientDecisionStatus,
          transactionId: record.transactionId,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      });
  }
}

export type { PayNoteDeliveryRepository } from '../application/ports';
