import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import {
  buildTouchPollingMarkerUpdateInput,
  mapPollingMarkerItem,
} from '@demo-bank-app/shared-core';
import type {
  PayNoteDeliveryRepository,
  PayNoteDeliveryRecord,
  PayNoteDeliveryPollingMarker,
  PayNoteDeliverySummary,
} from '../application/ports';
import type { CardTransactionDetails } from '@demo-bank-app/banking';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import {
  getDeliveryNameFromDocument,
  getPayNoteInitialMessageFromDocument,
  getProposalDescriptionFromDeliveryDocument,
  getPayNoteSummaryFromDocument,
} from '../application/payNoteDelivery/blueUtils';
import { toCompactBlueJsonValue } from '../application/blue/compactBlue';

const ENTITY_TYPES = {
  DELIVERY: 'PAYNOTE_DELIVERY',
  SESSION: 'PAYNOTE_DELIVERY_SESSION',
  CARD_TXN: 'PAYNOTE_DELIVERY_CARD_TXN',
  DOCUMENT: 'PAYNOTE_DELIVERY_DOCUMENT',
  PAYNOTE_DOCUMENT: 'PAYNOTE_DELIVERY_PAYNOTE_DOCUMENT',
  BOOTSTRAP: 'PAYNOTE_DELIVERY_BOOTSTRAP',
  EVENT: 'PAYNOTE_DELIVERY_EVENT',
  USER: 'PAYNOTE_DELIVERY_USER',
  POLL_MARKER: 'PAYNOTE_DELIVERY_POLL_MARKER',
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
const DELIVERY_POLL_MARKER_SK = 'POLL_MARKER#PROPOSALS';

const resolveSummaryPreview = (summary?: Record<string, unknown>) => {
  if (!summary || typeof summary !== 'object') {
    return undefined;
  }
  const summaryRecord = summary as {
    story?: { headline?: unknown };
    listPreview?: unknown;
  };
  const headline =
    typeof summaryRecord.story?.headline === 'string'
      ? summaryRecord.story.headline.trim()
      : '';
  const listPreview =
    typeof summaryRecord.listPreview === 'string'
      ? summaryRecord.listPreview.trim()
      : '';
  return headline || listPreview || undefined;
};

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
  deliveryEpoch?: number;
  synchronySessionId?: string;
  cardTransactionDetails?: CardTransactionDetails;
  cardTransactionDetailsKey?: string;
  accountNumber?: string;
  userId?: string;
  holdId?: string;
  transactionId?: string;
  merchantId?: string;
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
  paymentMandateDocumentId?: string;
  paymentMandateBootstrapSessionId?: string;
  paymentMandateStatus?: 'not_required' | 'pending' | 'attached' | 'failed';
  summary?: Record<string, unknown>;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  summarySourceEpoch?: number;
  summaryInputBlueId?: string;
  summaryModel?: string;
  summaryError?: string;
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
  status: 'processing' | 'completed';
  createdAt: string;
  updatedAt?: string;
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

  private buildDeliveryPollMarkerSk() {
    return DELIVERY_POLL_MARKER_SK;
  }

  private async touchDeliveryPollingMarker(input: {
    userId: string;
    latestUpdatedAt: string;
  }): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        ...buildTouchPollingMarkerUpdateInput({
          tableName: this.tableName,
          userPk: this.buildUserPk(input.userId),
          markerSk: this.buildDeliveryPollMarkerSk(),
          markerEntityType: ENTITY_TYPES.POLL_MARKER,
          latestUpdatedAt: input.latestUpdatedAt,
        }),
      })
    );
  }

  private mapItemToRecord(item: PayNoteDeliveryItem): PayNoteDeliveryRecord {
    const deliverySessionIds =
      item.deliverySessionIds && item.deliverySessionIds.length
        ? item.deliverySessionIds
        : undefined;
    const deliverySessionId = item.deliverySessionId ?? deliverySessionIds?.[0];

    return {
      deliveryId: item.deliveryId,
      deliveryDocumentId: item.deliveryDocumentId,
      deliverySessionId,
      deliverySessionIds,
      deliveryEpoch: item.deliveryEpoch,
      synchronySessionId: item.synchronySessionId,
      cardTransactionDetails: item.cardTransactionDetails,
      cardTransactionDetailsKey: item.cardTransactionDetailsKey,
      accountNumber: item.accountNumber,
      userId: item.userId,
      holdId: item.holdId,
      transactionId: item.transactionId,
      merchantId: item.merchantId,
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
      paymentMandateDocumentId: item.paymentMandateDocumentId,
      paymentMandateBootstrapSessionId: item.paymentMandateBootstrapSessionId,
      paymentMandateStatus: item.paymentMandateStatus,
      summary: item.summary,
      summaryUpdatedAt: item.summaryUpdatedAt,
      summarySourceUpdatedAt: item.summarySourceUpdatedAt,
      summarySourceEpoch: item.summarySourceEpoch,
      summaryInputBlueId: item.summaryInputBlueId,
      summaryModel: item.summaryModel,
      summaryError: item.summaryError,
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
      status: 'processing',
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

  async finalizeEventProcessing(eventId: string): Promise<void> {
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + 7 * 24 * 60 * 60;

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildEventPk(eventId),
          SK: SORT_KEYS.META,
        },
        UpdateExpression:
          'SET #status = :completed, #updatedAt = :updatedAt, #ttl = :ttl',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':completed': 'completed',
          ':updatedAt': now.toISOString(),
          ':ttl': ttl,
        },
        ConditionExpression: 'attribute_exists(PK)',
      })
    );
  }

  async releaseEventProcessing(eventId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            PK: this.buildEventPk(eventId),
            SK: SORT_KEYS.META,
          },
          ConditionExpression: '#status = :processing',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':processing': 'processing',
          },
        })
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        return;
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
        ConsistentRead: true,
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
        ConsistentRead: true,
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
        ConsistentRead: true,
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
        ConsistentRead: true,
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
        ConsistentRead: true,
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
        ConsistentRead: true,
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
    const compactDeliveryDocument = record.deliveryDocument
      ? (toCompactBlueJsonValue(record.deliveryDocument) as Record<
          string,
          unknown
        >)
      : undefined;
    const compactPayNoteDocument = record.payNoteDocument
      ? (toCompactBlueJsonValue(record.payNoteDocument) as Record<
          string,
          unknown
        >)
      : undefined;

    const normalizedDeliverySessionIds =
      record.deliverySessionIds && record.deliverySessionIds.length
        ? record.deliverySessionIds
        : record.deliverySessionId
        ? [record.deliverySessionId]
        : undefined;
    const normalizedDeliverySessionId =
      record.deliverySessionId ?? normalizedDeliverySessionIds?.[0];

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
      ...(normalizedDeliverySessionId
        ? { deliverySessionId: normalizedDeliverySessionId }
        : {}),
      ...(normalizedDeliverySessionIds
        ? { deliverySessionIds: normalizedDeliverySessionIds }
        : {}),
      ...(record.deliveryEpoch !== undefined
        ? { deliveryEpoch: record.deliveryEpoch }
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
      ...(record.merchantId ? { merchantId: record.merchantId } : {}),
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
      ...(compactDeliveryDocument
        ? { deliveryDocument: compactDeliveryDocument }
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
      ...(compactPayNoteDocument
        ? { payNoteDocument: compactPayNoteDocument }
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
      ...(record.paymentMandateDocumentId
        ? { paymentMandateDocumentId: record.paymentMandateDocumentId }
        : {}),
      ...(record.paymentMandateBootstrapSessionId
        ? {
            paymentMandateBootstrapSessionId:
              record.paymentMandateBootstrapSessionId,
          }
        : {}),
      ...(record.paymentMandateStatus
        ? { paymentMandateStatus: record.paymentMandateStatus }
        : {}),
      ...(record.summary ? { summary: record.summary } : {}),
      ...(record.summaryUpdatedAt
        ? { summaryUpdatedAt: record.summaryUpdatedAt }
        : {}),
      ...(record.summarySourceUpdatedAt
        ? { summarySourceUpdatedAt: record.summarySourceUpdatedAt }
        : {}),
      ...(record.summarySourceEpoch !== undefined
        ? { summarySourceEpoch: record.summarySourceEpoch }
        : {}),
      ...(record.summaryInputBlueId
        ? { summaryInputBlueId: record.summaryInputBlueId }
        : {}),
      ...(record.summaryModel ? { summaryModel: record.summaryModel } : {}),
      ...(record.summaryError ? { summaryError: record.summaryError } : {}),
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    const now = new Date().toISOString();
    const writes: Array<Promise<unknown>> = [];

    if (normalizedDeliverySessionIds?.length) {
      normalizedDeliverySessionIds.forEach(sessionId => {
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

    if (record.paymentMandateBootstrapSessionId) {
      const bootstrapItem: PayNoteDeliveryBootstrapItem = {
        PK: this.buildBootstrapPk(record.paymentMandateBootstrapSessionId),
        SK: SORT_KEYS.META,
        entityType: ENTITY_TYPES.BOOTSTRAP,
        bootstrapSessionId: record.paymentMandateBootstrapSessionId,
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
      writes.push(
        this.touchDeliveryPollingMarker({
          userId: record.userId,
          latestUpdatedAt: record.updatedAt ?? now,
        })
      );
    }

    if (writes.length) {
      await Promise.all(writes);
    }
  }

  async updateDeliverySummary(input: {
    deliveryId: string;
    summary?: Record<string, unknown>;
    summaryUpdatedAt?: string;
    summarySourceUpdatedAt?: string;
    summarySourceEpoch?: number;
    summaryInputBlueId?: string;
    summaryModel?: string;
    summaryError?: string | null;
    userId?: string;
  }): Promise<void> {
    const {
      deliveryId,
      summary,
      summaryUpdatedAt,
      summarySourceUpdatedAt,
      summarySourceEpoch,
      summaryInputBlueId,
      summaryModel,
      summaryError,
      userId,
    } = input;

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const setExpressions: string[] = [];
    const removeExpressions: string[] = [];

    if (summary !== undefined) {
      names['#summary'] = 'summary';
      values[':summary'] = summary;
      setExpressions.push('#summary = :summary');
    }
    if (summaryUpdatedAt !== undefined) {
      names['#summaryUpdatedAt'] = 'summaryUpdatedAt';
      values[':summaryUpdatedAt'] = summaryUpdatedAt;
      setExpressions.push('#summaryUpdatedAt = :summaryUpdatedAt');
    }
    if (summarySourceUpdatedAt !== undefined) {
      names['#summarySourceUpdatedAt'] = 'summarySourceUpdatedAt';
      values[':summarySourceUpdatedAt'] = summarySourceUpdatedAt;
      setExpressions.push('#summarySourceUpdatedAt = :summarySourceUpdatedAt');
    }
    if (summarySourceEpoch !== undefined) {
      names['#summarySourceEpoch'] = 'summarySourceEpoch';
      values[':summarySourceEpoch'] = summarySourceEpoch;
      setExpressions.push('#summarySourceEpoch = :summarySourceEpoch');
    }
    if (summaryInputBlueId !== undefined) {
      names['#summaryInputBlueId'] = 'summaryInputBlueId';
      values[':summaryInputBlueId'] = summaryInputBlueId;
      setExpressions.push('#summaryInputBlueId = :summaryInputBlueId');
    }
    if (summaryModel !== undefined) {
      names['#summaryModel'] = 'summaryModel';
      values[':summaryModel'] = summaryModel;
      setExpressions.push('#summaryModel = :summaryModel');
    }

    if (summaryError === null) {
      names['#summaryError'] = 'summaryError';
      removeExpressions.push('#summaryError');
    } else if (summaryError !== undefined) {
      names['#summaryError'] = 'summaryError';
      values[':summaryError'] = summaryError;
      setExpressions.push('#summaryError = :summaryError');
    }

    if (!setExpressions.length && !removeExpressions.length) {
      return;
    }

    const updateExpressionParts = [];
    if (setExpressions.length) {
      updateExpressionParts.push(`SET ${setExpressions.join(', ')}`);
    }
    if (removeExpressions.length) {
      updateExpressionParts.push(`REMOVE ${removeExpressions.join(', ')}`);
    }

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildDeliveryPk(deliveryId),
          SK: SORT_KEYS.META,
        },
        ConditionExpression: 'attribute_exists(PK)',
        UpdateExpression: updateExpressionParts.join(' '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: Object.keys(values).length
          ? values
          : undefined,
      })
    );

    if (userId) {
      await this.touchDeliveryPollingMarker({
        userId,
        latestUpdatedAt:
          summarySourceUpdatedAt ??
          summaryUpdatedAt ??
          new Date().toISOString(),
      });
    }
  }

  async listDeliveriesByUserId(
    userId: string
  ): Promise<PayNoteDeliverySummary[]> {
    const query = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ConsistentRead: true,
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
      .filter(
        record => Boolean(record.summary) && Boolean(record.summaryUpdatedAt)
      )
      .map(record => {
        const deliveryDocument = record.deliveryDocument as
          | {
              payNoteBootstrapRequest?: { document?: unknown };
              payNote?: unknown;
            }
          | undefined;
        const payNotePayloadFromDelivery =
          deliveryDocument?.payNoteBootstrapRequest?.document ??
          deliveryDocument?.payNote;
        const payNotePayload =
          payNotePayloadFromDelivery ?? record.payNoteDocument;
        const payNoteSummary = getPayNoteSummaryFromDocument(payNotePayload);
        const deliveryName = record.deliveryDocument
          ? getDeliveryNameFromDocument(record.deliveryDocument)
          : undefined;
        const summaryUpdatedAt =
          record.summarySourceUpdatedAt ??
          record.summaryUpdatedAt ??
          record.updatedAt;
        const summaryPreview = resolveSummaryPreview(
          record.summary as Record<string, unknown> | undefined
        );
        const proposalDescription =
          getPayNoteInitialMessageFromDocument(payNotePayloadFromDelivery) ??
          getPayNoteInitialMessageFromDocument(record.payNoteDocument) ??
          (record.deliveryDocument
            ? getProposalDescriptionFromDeliveryDocument(
                record.deliveryDocument
              )
            : undefined);

        return {
          deliveryId: record.deliveryId,
          deliverySessionId: record.deliverySessionId,
          payNoteSessionIds: record.payNoteSessionIds,
          payNoteDocumentId: record.payNoteDocumentId,
          name: payNoteSummary.name ?? deliveryName,
          proposalDescription,
          amountMinor: payNoteSummary.amountMinor,
          currency: payNoteSummary.currency,
          merchantId: record.merchantId,
          summaryPreview,
          deliveryStatus: record.deliveryStatus,
          transactionIdentificationStatus:
            record.transactionIdentificationStatus,
          clientDecisionStatus: record.clientDecisionStatus,
          transactionId: record.transactionId,
          holdId: record.holdId,
          paymentMandateDocumentId: record.paymentMandateDocumentId,
          paymentMandateStatus: record.paymentMandateStatus,
          createdAt: record.createdAt,
          updatedAt: summaryUpdatedAt,
        };
      });
  }

  async getDeliveryPollingMarkerByUserId(
    userId: string
  ): Promise<PayNoteDeliveryPollingMarker> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildUserPk(userId),
          SK: this.buildDeliveryPollMarkerSk(),
        },
        ConsistentRead: true,
      })
    );

    return mapPollingMarkerItem(response.Item);
  }
}

export type { PayNoteDeliveryRepository } from '../application/ports';
