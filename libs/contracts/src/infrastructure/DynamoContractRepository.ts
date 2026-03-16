import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import { Blue, BlueNode } from '@blue-labs/language';
import { repository as blueRepository } from '@blue-repository/types';
import { createDefaultMergingProcessor } from '@blue-labs/document-processor';
import {
  BatchGetCommand,
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
  ContractMonitoringSubscription,
  ContractRecord,
  ContractRepository,
  ContractSummary,
  ContractPollingMarker,
  ContractDocumentSummary,
  ContractPendingAction,
  ContractHistoryEntry,
  ContractHistoryEntryInput,
  ContractSummarySnapshot,
  ContractSummaryUpdate,
  ContractArchiveUpdate,
} from '../application/ports';
import {
  buildContractSummarySnapshot,
  buildContractSummaryUpdateExpressions,
} from './contractSummaryUpdateBuilder';

const ENTITY_TYPES = {
  CONTRACT: 'CONTRACT',
  SESSION: 'CONTRACT_SESSION',
  DOCUMENT: 'CONTRACT_DOCUMENT',
  USER: 'CONTRACT_USER',
  RELATIONSHIP: 'CONTRACT_RELATIONSHIP',
  HISTORY: 'CONTRACT_HISTORY',
  SUMMARY_EVENT: 'CONTRACT_SUMMARY_EVENT',
  SUMMARY_SNAPSHOT: 'CONTRACT_SUMMARY_SNAPSHOT',
  CONTRACT_DOCUMENT: 'CONTRACT_DOCUMENT',
  POLL_MARKER: 'CONTRACT_POLL_MARKER',
} as const;

const TABLE_PREFIXES = {
  CONTRACT: 'CONTRACT#',
  SESSION: 'CONTRACT_SESSION#',
  DOCUMENT: 'CONTRACT_DOCUMENT#',
  USER: 'USER#',
  TRANSACTION: 'TXN#',
  HOLD: 'HOLD#',
  SUMMARY_EVENT: 'CONTRACT_SUMMARY_EVENT#',
} as const;

const SORT_KEYS = {
  META: 'META',
  SUMMARY: 'SUMMARY',
  DOCUMENT: 'DOCUMENT',
} as const;

const USER_SORT_KEY_PREFIX = 'CONTRACT#';
const RELATIONSHIP_SORT_KEY_PREFIX = 'CONTRACT#';
const HISTORY_SORT_KEY_PREFIX = 'HISTORY#';
const CONTRACT_POLL_MARKER_SK = 'POLL_MARKER#CONTRACTS';

const normalizeSummaryText = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const resolveSummaryPreview = (
  summary?: ContractDocumentSummary | null,
  fallbackPreview?: string | null
): string | undefined =>
  normalizeSummaryText(summary?.story?.headline) ??
  normalizeSummaryText(summary?.lastChange?.short) ??
  normalizeSummaryText(summary?.listPreview) ??
  normalizeSummaryText(fallbackPreview);

const hasPendingContractAction = (
  pendingActions?: ContractPendingAction[]
): boolean =>
  pendingActions?.some(action => action.status === 'pending') ?? false;

const compactBlue = new Blue({
  repositories: [blueRepository],
  mergingProcessor: createDefaultMergingProcessor(),
});

const stripResolvedTypeRefsToBlueId = (node: BlueNode): BlueNode => {
  const stripType = (typeNode: BlueNode | undefined): BlueNode | undefined => {
    if (!typeNode) {
      return undefined;
    }
    const blueId = typeNode.getBlueId();
    if (!blueId) {
      return typeNode;
    }
    return new BlueNode().setBlueId(blueId);
  };

  const visit = (current: BlueNode) => {
    current.setType(stripType(current.getType()));
    current.setItemType(stripType(current.getItemType()));
    current.setKeyType(stripType(current.getKeyType()));
    current.setValueType(stripType(current.getValueType()));

    const properties = current.getProperties();
    if (properties) {
      Object.values(properties).forEach(visit);
    }

    const items = current.getItems();
    if (items) {
      items.forEach(visit);
    }
  };

  const cloned = node.clone();
  visit(cloned);
  return cloned;
};

const toCompactBlueJsonValue = (value: unknown): unknown => {
  if (value === undefined || value === null) {
    return value;
  }

  try {
    const node = compactBlue.jsonValueToNode(value);
    return compactBlue.nodeToJson(
      stripResolvedTypeRefsToBlueId(node),
      'official'
    );
  } catch {
    return value;
  }
};

const toCompactBlueRecord = (
  value: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }
  const compact = toCompactBlueJsonValue(value);
  if (!compact || typeof compact !== 'object' || Array.isArray(compact)) {
    return value;
  }
  return compact as Record<string, unknown>;
};

const toCompactBlueEventArray = (value: unknown[] | null | undefined) => {
  if (!value) {
    return undefined;
  }
  const compact = toCompactBlueJsonValue(value);
  if (Array.isArray(compact)) {
    return compact;
  }
  if (
    compact &&
    typeof compact === 'object' &&
    Array.isArray((compact as { items?: unknown[] }).items)
  ) {
    return (compact as { items: unknown[] }).items;
  }
  return value;
};

type DynamoContractRepositoryConfig = {
  tableName: string;
  region: string;
  endpoint?: string;
};

interface ContractItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.CONTRACT;
  contractId: string;
  typeBlueId: string;
  displayName: string;
  documentName?: string;
  customerChannelKey?: string;
  sessionId?: string;
  documentId?: string;
  document?: Record<string, unknown>;
  status?: string;
  archivedAt?: string;
  statusUpdatedAt?: string;
  statusTimestamps?: Record<string, string>;
  triggerEvent?: unknown;
  emittedEvents?: unknown[];
  relatedTransactionIds?: string[];
  relatedHoldIds?: string[];
  accountNumber?: string;
  userId?: string;
  merchantId?: string;
  summary?: ContractDocumentSummary;
  summaryPreview?: string;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  summarySourceEpoch?: number;
  summaryInputBlueId?: string;
  summaryModel?: string;
  summaryError?: string;
  summaryDocument?: Record<string, unknown>;
  summaryDocumentName?: string;
  summaryStatus?: string;
  summaryStatusUpdatedAt?: string;
  summaryStatusTimestamps?: Record<string, string>;
  summaryTriggerEvent?: unknown;
  summaryEmittedEvents?: unknown[];
  pendingActions?: ContractPendingAction[];
  monitoringSubscriptions?: ContractMonitoringSubscription[];
  createdAt: string;
  updatedAt: string;
}

interface ContractSessionItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.SESSION;
  sessionId: string;
  contractId: string;
  createdAt: string;
}

interface ContractDocumentItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.DOCUMENT;
  documentId: string;
  contractId: string;
  createdAt: string;
}

interface ContractDocumentSnapshotItem {
  PK: string;
  SK: typeof SORT_KEYS.DOCUMENT;
  entityType: typeof ENTITY_TYPES.CONTRACT_DOCUMENT;
  contractId: string;
  document?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ContractUserItem {
  PK: string;
  SK: string;
  entityType: typeof ENTITY_TYPES.USER;
  contractId: string;
  typeBlueId: string;
  displayName: string;
  documentName?: string;
  customerChannelKey?: string;
  sessionId?: string;
  documentId?: string;
  status?: string;
  hasPendingAction?: boolean;
  archivedAt?: string;
  merchantId?: string;
  summaryPreview?: string;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  summarySourceEpoch?: number;
  summaryDocumentName?: string;
  createdAt: string;
  updatedAt: string;
}

interface ContractRelationshipItem {
  PK: string;
  SK: string;
  entityType: typeof ENTITY_TYPES.RELATIONSHIP;
  contractId: string;
  typeBlueId: string;
  displayName: string;
  documentName?: string;
  customerChannelKey?: string;
  sessionId?: string;
  documentId?: string;
  status?: string;
  hasPendingAction?: boolean;
  userId?: string;
  archivedAt?: string;
  merchantId?: string;
  summaryPreview?: string;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  summarySourceEpoch?: number;
  summaryDocumentName?: string;
  createdAt: string;
  updatedAt: string;
}

interface ContractHistoryItem {
  PK: string;
  SK: string;
  entityType: typeof ENTITY_TYPES.HISTORY;
  historyId: string;
  contractId: string;
  kind: ContractHistoryEntry['kind'];
  short: string;
  more?: string;
  createdAt: string;
}

interface ContractSummaryEventItem {
  PK: string;
  SK: typeof SORT_KEYS.META;
  entityType: typeof ENTITY_TYPES.SUMMARY_EVENT;
  eventId: string;
  createdAt: string;
  ttl?: number;
}

interface ContractSummarySnapshotItem {
  PK: string;
  SK: typeof SORT_KEYS.SUMMARY;
  entityType: typeof ENTITY_TYPES.SUMMARY_SNAPSHOT;
  contractId: string;
  summaryDocument?: Record<string, unknown>;
  summaryStatus?: string;
  summaryStatusUpdatedAt?: string;
  summaryStatusTimestamps?: Record<string, string>;
  summaryTriggerEvent?: unknown;
  summaryEmittedEvents?: unknown[];
  summarySourceUpdatedAt?: string;
  summarySourceEpoch?: number;
  summaryUpdatedAt?: string;
  summaryInputBlueId?: string;
  createdAt: string;
  updatedAt: string;
}

export class DynamoContractRepository implements ContractRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(config: DynamoContractRepositoryConfig) {
    this.tableName = config.tableName;
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  private buildContractPk(contractId: string) {
    return `${TABLE_PREFIXES.CONTRACT}${contractId}`;
  }

  private buildSessionPk(sessionId: string) {
    return `${TABLE_PREFIXES.SESSION}${sessionId}`;
  }

  private buildDocumentPk(documentId: string) {
    return `${TABLE_PREFIXES.DOCUMENT}${documentId}`;
  }

  private buildContractDocumentPk(contractId: string) {
    return this.buildContractPk(contractId);
  }

  private buildUserPk(userId: string) {
    return `${TABLE_PREFIXES.USER}${userId}`;
  }

  private buildUserSk(contractId: string) {
    return `${USER_SORT_KEY_PREFIX}${contractId}`;
  }

  private buildContractPollMarkerSk() {
    return CONTRACT_POLL_MARKER_SK;
  }

  private buildTransactionPk(transactionId: string) {
    return `${TABLE_PREFIXES.TRANSACTION}${transactionId}`;
  }

  private buildHoldPk(holdId: string) {
    return `${TABLE_PREFIXES.HOLD}${holdId}`;
  }

  private buildSummarySnapshotPk(contractId: string) {
    return this.buildContractPk(contractId);
  }

  private buildSummaryEventPk(eventId: string) {
    return `${TABLE_PREFIXES.SUMMARY_EVENT}${eventId}`;
  }

  private buildRelationshipSk(contractId: string) {
    return `${RELATIONSHIP_SORT_KEY_PREFIX}${contractId}`;
  }

  private buildHistorySk(createdAt: string, historyId: string) {
    return `${HISTORY_SORT_KEY_PREFIX}${createdAt}#${historyId}`;
  }

  private async touchContractPollingMarker(input: {
    userId: string;
    latestUpdatedAt: string;
  }): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        ...buildTouchPollingMarkerUpdateInput({
          tableName: this.tableName,
          userPk: this.buildUserPk(input.userId),
          markerSk: this.buildContractPollMarkerSk(),
          markerEntityType: ENTITY_TYPES.POLL_MARKER,
          latestUpdatedAt: input.latestUpdatedAt,
        }),
      })
    );
  }

  private async hydratePendingActionFlags(
    contractIds: string[]
  ): Promise<Map<string, boolean>> {
    const uniqueContractIds = Array.from(new Set(contractIds.filter(Boolean)));
    if (!uniqueContractIds.length) {
      return new Map();
    }

    const flags = new Map<string, boolean>();
    const chunkSize = 100;
    type PendingActionMetaKey = { PK: string; SK: typeof SORT_KEYS.META };

    for (let index = 0; index < uniqueContractIds.length; index += chunkSize) {
      const chunk = uniqueContractIds.slice(index, index + chunkSize);
      let pendingKeys: PendingActionMetaKey[] = chunk.map(contractId => ({
        PK: this.buildContractPk(contractId),
        SK: SORT_KEYS.META,
      }));
      let retries = 0;
      const maxRetries = 5;

      while (pendingKeys.length && retries <= maxRetries) {
        const response = await this.client.send(
          new BatchGetCommand({
            RequestItems: {
              [this.tableName]: {
                Keys: pendingKeys,
                ConsistentRead: true,
                ProjectionExpression: 'contractId, pendingActions',
              },
            },
          })
        );

        const items = (response.Responses?.[this.tableName] ?? []) as Array<
          Pick<ContractItem, 'contractId' | 'pendingActions'>
        >;
        items.forEach(item => {
          if (!item.contractId) {
            return;
          }
          flags.set(
            item.contractId,
            hasPendingContractAction(item.pendingActions)
          );
        });

        const unprocessed = (response.UnprocessedKeys?.[this.tableName]?.Keys ??
          []) as PendingActionMetaKey[];
        if (!unprocessed.length) {
          break;
        }

        pendingKeys = unprocessed;
        retries += 1;
      }
    }

    return flags;
  }

  private mapItemToRecord(item: ContractItem): ContractRecord {
    return {
      contractId: item.contractId,
      typeBlueId: item.typeBlueId,
      displayName: item.displayName,
      documentName: item.summaryDocumentName ?? item.documentName,
      customerChannelKey: item.customerChannelKey,
      sessionId: item.sessionId,
      documentId: item.documentId,
      document: item.document,
      status: item.status,
      archivedAt: item.archivedAt,
      statusUpdatedAt: item.statusUpdatedAt,
      statusTimestamps: item.statusTimestamps,
      triggerEvent: item.triggerEvent,
      emittedEvents: item.emittedEvents,
      relatedTransactionIds: item.relatedTransactionIds,
      relatedHoldIds: item.relatedHoldIds,
      accountNumber: item.accountNumber,
      userId: item.userId,
      merchantId: item.merchantId,
      summary: item.summary,
      summaryPreview: resolveSummaryPreview(item.summary, item.summaryPreview),
      summaryUpdatedAt: item.summaryUpdatedAt,
      summarySourceUpdatedAt: item.summarySourceUpdatedAt,
      summarySourceEpoch: item.summarySourceEpoch,
      summaryInputBlueId: item.summaryInputBlueId,
      summaryModel: item.summaryModel,
      summaryError: item.summaryError,
      summaryDocument: item.summaryDocument,
      summaryDocumentName: item.summaryDocumentName,
      summaryStatus: item.summaryStatus,
      summaryStatusUpdatedAt: item.summaryStatusUpdatedAt,
      summaryStatusTimestamps: item.summaryStatusTimestamps,
      summaryTriggerEvent: item.summaryTriggerEvent,
      summaryEmittedEvents: item.summaryEmittedEvents,
      pendingActions: item.pendingActions,
      monitoringSubscriptions: item.monitoringSubscriptions,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async getContract(contractId: string): Promise<ContractRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildContractPk(contractId),
          SK: SORT_KEYS.META,
        },
        ConsistentRead: true,
      })
    );

    if (!response.Item) {
      return null;
    }

    const record = this.mapItemToRecord(response.Item as ContractItem);
    const documentResponse = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildContractDocumentPk(contractId),
          SK: SORT_KEYS.DOCUMENT,
        },
        ConsistentRead: true,
      })
    );
    const documentItem = documentResponse.Item as
      | ContractDocumentSnapshotItem
      | undefined;
    if (documentItem?.document) {
      record.document = documentItem.document;
    }
    return record;
  }

  async getContractBySessionId(
    sessionId: string
  ): Promise<ContractRecord | null> {
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

    const contractId = (response.Item as ContractSessionItem | undefined)
      ?.contractId;
    if (!contractId) {
      return null;
    }

    const contract = await this.getContract(contractId);
    if (!contract || contract.sessionId !== sessionId) {
      return null;
    }

    return contract;
  }

  async getContractByDocumentId(
    documentId: string
  ): Promise<ContractRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildDocumentPk(documentId),
          SK: SORT_KEYS.META,
        },
        ConsistentRead: true,
      })
    );

    const contractId = (response.Item as ContractDocumentItem | undefined)
      ?.contractId;
    if (!contractId) {
      return null;
    }

    return this.getContract(contractId);
  }

  async claimCanonicalSessionByDocumentId(input: {
    documentId: string;
    sessionId: string;
    createdAt: string;
  }): Promise<{
    canonicalContractId: string;
    isCanonicalOwner: boolean;
  }> {
    const item: ContractDocumentItem = {
      PK: this.buildDocumentPk(input.documentId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.DOCUMENT,
      documentId: input.documentId,
      contractId: input.sessionId,
      createdAt: input.createdAt,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK) OR contractId = :cid',
          ExpressionAttributeValues: {
            ':cid': input.sessionId,
          },
        })
      );

      return {
        canonicalContractId: input.sessionId,
        isCanonicalOwner: true,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        const existing = await this.client.send(
          new GetCommand({
            TableName: this.tableName,
            Key: {
              PK: this.buildDocumentPk(input.documentId),
              SK: SORT_KEYS.META,
            },
            ConsistentRead: true,
          })
        );

        const canonicalContractId = (
          existing.Item as ContractDocumentItem | undefined
        )?.contractId;
        if (canonicalContractId) {
          return {
            canonicalContractId,
            isCanonicalOwner: canonicalContractId === input.sessionId,
          };
        }
      }

      throw error;
    }
  }

  async linkSessionToContract(input: {
    sessionId: string;
    contractId: string;
    createdAt: string;
  }): Promise<void> {
    const sessionItem: ContractSessionItem = {
      PK: this.buildSessionPk(input.sessionId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.SESSION,
      sessionId: input.sessionId,
      contractId: input.contractId,
      createdAt: input.createdAt,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: sessionItem,
          ConditionExpression: 'attribute_not_exists(PK) OR contractId = :cid',
          ExpressionAttributeValues: {
            ':cid': input.contractId,
          },
        })
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== 'ConditionalCheckFailedException' ||
        input.contractId === input.sessionId
      ) {
        throw error;
      }

      const existingResponse = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            PK: this.buildSessionPk(input.sessionId),
            SK: SORT_KEYS.META,
          },
          ConsistentRead: true,
        })
      );
      const existingSession = existingResponse.Item as
        | ContractSessionItem
        | undefined;

      if (existingSession?.contractId !== input.sessionId) {
        throw error;
      }

      const provisionalContract = await this.getContract(input.sessionId);
      if (
        !provisionalContract ||
        provisionalContract.sessionId !== input.sessionId ||
        provisionalContract.documentId
      ) {
        throw error;
      }

      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            ...sessionItem,
            createdAt: existingSession.createdAt ?? input.createdAt,
          },
          ConditionExpression: 'contractId = :existingContractId',
          ExpressionAttributeValues: {
            ':existingContractId': input.sessionId,
          },
        })
      );
    }
  }

  async getContractSummarySnapshot(
    contractId: string
  ): Promise<ContractSummarySnapshot | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildSummarySnapshotPk(contractId),
          SK: SORT_KEYS.SUMMARY,
        },
      })
    );

    const item = response.Item as ContractSummarySnapshotItem | undefined;
    if (!item) {
      return null;
    }

    return {
      contractId: item.contractId,
      summaryDocument: item.summaryDocument,
      summaryStatus: item.summaryStatus,
      summaryStatusUpdatedAt: item.summaryStatusUpdatedAt,
      summaryStatusTimestamps: item.summaryStatusTimestamps,
      summaryTriggerEvent: item.summaryTriggerEvent,
      summaryEmittedEvents: item.summaryEmittedEvents,
      summarySourceUpdatedAt: item.summarySourceUpdatedAt,
      summarySourceEpoch: item.summarySourceEpoch,
      summaryUpdatedAt: item.summaryUpdatedAt,
      summaryInputBlueId: item.summaryInputBlueId,
    };
  }

  async saveContract(record: ContractRecord): Promise<void> {
    const compactDocument = toCompactBlueRecord(record.document);
    const compactTriggerEvent = toCompactBlueJsonValue(record.triggerEvent);
    const compactEmittedEvents = toCompactBlueEventArray(record.emittedEvents);
    const compactSummaryTriggerEvent = toCompactBlueJsonValue(
      record.summaryTriggerEvent
    );
    const compactSummaryEmittedEvents = toCompactBlueEventArray(
      record.summaryEmittedEvents
    );

    const item: ContractItem = {
      PK: this.buildContractPk(record.contractId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.CONTRACT,
      contractId: record.contractId,
      typeBlueId: record.typeBlueId,
      displayName: record.displayName,
      documentName: record.documentName,
      customerChannelKey: record.customerChannelKey,
      sessionId: record.sessionId,
      documentId: record.documentId,
      document: undefined,
      status: record.status,
      archivedAt: record.archivedAt,
      statusUpdatedAt: record.statusUpdatedAt,
      statusTimestamps: record.statusTimestamps,
      triggerEvent: compactTriggerEvent,
      emittedEvents: compactEmittedEvents,
      relatedTransactionIds: record.relatedTransactionIds,
      relatedHoldIds: record.relatedHoldIds,
      accountNumber: record.accountNumber,
      userId: record.userId,
      merchantId: record.merchantId,
      summary: record.summary,
      summaryPreview: resolveSummaryPreview(
        record.summary,
        record.summaryPreview
      ),
      summaryUpdatedAt: record.summaryUpdatedAt,
      summarySourceUpdatedAt: record.summarySourceUpdatedAt,
      summarySourceEpoch: record.summarySourceEpoch,
      summaryInputBlueId: record.summaryInputBlueId,
      summaryModel: record.summaryModel,
      summaryError: record.summaryError,
      summaryDocument: undefined,
      summaryDocumentName: record.summaryDocumentName,
      summaryStatus: record.summaryStatus,
      summaryStatusUpdatedAt: record.summaryStatusUpdatedAt,
      summaryStatusTimestamps: record.summaryStatusTimestamps,
      summaryTriggerEvent: compactSummaryTriggerEvent,
      summaryEmittedEvents: compactSummaryEmittedEvents,
      pendingActions: record.pendingActions,
      monitoringSubscriptions: record.monitoringSubscriptions,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    const writes: Array<Promise<unknown>> = [];

    if (record.sessionId) {
      const sessionItem: ContractSessionItem = {
        PK: this.buildSessionPk(record.sessionId),
        SK: SORT_KEYS.META,
        entityType: ENTITY_TYPES.SESSION,
        sessionId: record.sessionId,
        contractId: record.contractId,
        createdAt: record.createdAt,
      };
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: sessionItem })
        )
      );
    }

    if (record.documentId) {
      const documentItem: ContractDocumentItem = {
        PK: this.buildDocumentPk(record.documentId),
        SK: SORT_KEYS.META,
        entityType: ENTITY_TYPES.DOCUMENT,
        documentId: record.documentId,
        contractId: record.contractId,
        createdAt: record.createdAt,
      };
      writes.push(
        this.client.send(
          new PutCommand({
            TableName: this.tableName,
            Item: documentItem,
            ConditionExpression:
              'attribute_not_exists(PK) OR contractId = :cid',
            ExpressionAttributeValues: {
              ':cid': record.contractId,
            },
          })
        )
      );
    }

    if (record.document) {
      const documentSnapshot: ContractDocumentSnapshotItem = {
        PK: this.buildContractDocumentPk(record.contractId),
        SK: SORT_KEYS.DOCUMENT,
        entityType: ENTITY_TYPES.CONTRACT_DOCUMENT,
        contractId: record.contractId,
        document: compactDocument,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: documentSnapshot })
        )
      );
    }

    if (record.userId) {
      const userItem: ContractUserItem = {
        PK: this.buildUserPk(record.userId),
        SK: this.buildUserSk(record.contractId),
        entityType: ENTITY_TYPES.USER,
        contractId: record.contractId,
        typeBlueId: record.typeBlueId,
        displayName: record.displayName,
        documentName: record.documentName,
        customerChannelKey: record.customerChannelKey,
        sessionId: record.sessionId,
        documentId: record.documentId,
        status: record.status,
        hasPendingAction: hasPendingContractAction(record.pendingActions),
        archivedAt: record.archivedAt,
        merchantId: record.merchantId,
        summaryPreview: resolveSummaryPreview(
          record.summary,
          record.summaryPreview
        ),
        summaryUpdatedAt: record.summaryUpdatedAt,
        summarySourceUpdatedAt: record.summarySourceUpdatedAt,
        summarySourceEpoch: record.summarySourceEpoch,
        summaryDocumentName: record.summaryDocumentName,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: userItem })
        )
      );
      writes.push(
        this.touchContractPollingMarker({
          userId: record.userId,
          latestUpdatedAt:
            record.summarySourceUpdatedAt ??
            record.summaryUpdatedAt ??
            record.updatedAt,
        })
      );
    }

    const relationshipItems: ContractRelationshipItem[] = [];
    const buildRelationshipItem = (pk: string): ContractRelationshipItem => ({
      PK: pk,
      SK: this.buildRelationshipSk(record.contractId),
      entityType: ENTITY_TYPES.RELATIONSHIP,
      contractId: record.contractId,
      typeBlueId: record.typeBlueId,
      displayName: record.displayName,
      documentName: record.documentName,
      customerChannelKey: record.customerChannelKey,
      sessionId: record.sessionId,
      documentId: record.documentId,
      status: record.status,
      hasPendingAction: hasPendingContractAction(record.pendingActions),
      userId: record.userId,
      archivedAt: record.archivedAt,
      merchantId: record.merchantId,
      summaryPreview: resolveSummaryPreview(
        record.summary,
        record.summaryPreview
      ),
      summaryUpdatedAt: record.summaryUpdatedAt,
      summarySourceUpdatedAt: record.summarySourceUpdatedAt,
      summarySourceEpoch: record.summarySourceEpoch,
      summaryDocumentName: record.summaryDocumentName,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    if (record.relatedTransactionIds?.length) {
      record.relatedTransactionIds.forEach(transactionId => {
        relationshipItems.push(
          buildRelationshipItem(this.buildTransactionPk(transactionId))
        );
      });
    }

    if (record.relatedHoldIds?.length) {
      record.relatedHoldIds.forEach(holdId => {
        relationshipItems.push(buildRelationshipItem(this.buildHoldPk(holdId)));
      });
    }

    relationshipItems.forEach(item => {
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: item })
        )
      );
    });

    if (writes.length) {
      await Promise.all(writes);
    }
  }

  async saveContractSummarySnapshot(
    snapshot: ContractSummarySnapshot
  ): Promise<void> {
    const now = new Date().toISOString();
    const compactSummaryDocument = toCompactBlueRecord(
      snapshot.summaryDocument
    );
    const compactSummaryTriggerEvent = toCompactBlueJsonValue(
      snapshot.summaryTriggerEvent
    );
    const compactSummaryEmittedEvents = toCompactBlueEventArray(
      snapshot.summaryEmittedEvents
    );
    const item: ContractSummarySnapshotItem = {
      PK: this.buildSummarySnapshotPk(snapshot.contractId),
      SK: SORT_KEYS.SUMMARY,
      entityType: ENTITY_TYPES.SUMMARY_SNAPSHOT,
      contractId: snapshot.contractId,
      summaryDocument: compactSummaryDocument,
      summaryStatus: snapshot.summaryStatus ?? undefined,
      summaryStatusUpdatedAt: snapshot.summaryStatusUpdatedAt ?? undefined,
      summaryStatusTimestamps: snapshot.summaryStatusTimestamps ?? undefined,
      summaryTriggerEvent: compactSummaryTriggerEvent,
      summaryEmittedEvents: compactSummaryEmittedEvents,
      summarySourceUpdatedAt: snapshot.summarySourceUpdatedAt ?? undefined,
      summarySourceEpoch: snapshot.summarySourceEpoch ?? undefined,
      summaryUpdatedAt: snapshot.summaryUpdatedAt ?? undefined,
      summaryInputBlueId: snapshot.summaryInputBlueId ?? undefined,
      createdAt: now,
      updatedAt: now,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  async markSummaryEventProcessed(eventId: string): Promise<boolean> {
    const createdAt = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
    const item: ContractSummaryEventItem = {
      PK: this.buildSummaryEventPk(eventId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.SUMMARY_EVENT,
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

  async addContractHistoryEntry(
    entry: ContractHistoryEntryInput
  ): Promise<ContractHistoryEntry> {
    const createdAt = entry.createdAt ?? new Date().toISOString();
    const historyId = entry.id ?? randomUUID();
    const item: ContractHistoryItem = {
      PK: this.buildContractPk(entry.contractId),
      SK: this.buildHistorySk(createdAt, historyId),
      entityType: ENTITY_TYPES.HISTORY,
      historyId,
      contractId: entry.contractId,
      kind: entry.kind,
      short: entry.short,
      ...(entry.more ? { more: entry.more } : {}),
      createdAt,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );

    return {
      id: historyId,
      contractId: entry.contractId,
      kind: entry.kind,
      short: entry.short,
      more: entry.more,
      createdAt,
    };
  }

  async listContractHistory(
    contractId: string
  ): Promise<ContractHistoryEntry[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': 'PK',
          '#sk': 'SK',
        },
        ExpressionAttributeValues: {
          ':pk': this.buildContractPk(contractId),
          ':skPrefix': HISTORY_SORT_KEY_PREFIX,
        },
        ScanIndexForward: false,
      })
    );

    const items = (response.Items ?? []) as ContractHistoryItem[];

    return items.map(item => ({
      id: item.historyId,
      contractId: item.contractId,
      kind: item.kind,
      short: item.short,
      more: item.more,
      createdAt: item.createdAt,
    }));
  }

  async updateContractArchive(update: ContractArchiveUpdate): Promise<void> {
    const setters: string[] = ['#updatedAt = :updatedAt'];
    const removals: string[] = [];
    const names: Record<string, string> = {
      '#pk': 'PK',
      '#updatedAt': 'updatedAt',
      '#archivedAt': 'archivedAt',
    };
    const values: Record<string, unknown> = {
      ':updatedAt': update.updatedAt,
    };

    if (update.archivedAt === null) {
      removals.push('#archivedAt');
    } else {
      values[':archivedAt'] = update.archivedAt;
      setters.push('#archivedAt = :archivedAt');
    }

    const expressions: string[] = [];
    if (setters.length) {
      expressions.push(`SET ${setters.join(', ')}`);
    }
    if (removals.length) {
      expressions.push(`REMOVE ${removals.join(', ')}`);
    }

    const updateRequest = {
      TableName: this.tableName,
      ConditionExpression: 'attribute_exists(#pk)',
      UpdateExpression: expressions.join(' '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    };

    await this.client.send(
      new UpdateCommand({
        ...updateRequest,
        Key: {
          PK: this.buildContractPk(update.contractId),
          SK: SORT_KEYS.META,
        },
      })
    );

    const updates: Array<Promise<unknown>> = [];

    if (update.userId) {
      updates.push(
        this.client.send(
          new UpdateCommand({
            ...updateRequest,
            Key: {
              PK: this.buildUserPk(update.userId),
              SK: this.buildUserSk(update.contractId),
            },
          })
        )
      );
    }

    const relatedTransactionIds = update.relatedTransactionIds ?? [];
    relatedTransactionIds.forEach(transactionId => {
      updates.push(
        this.client.send(
          new UpdateCommand({
            ...updateRequest,
            Key: {
              PK: this.buildTransactionPk(transactionId),
              SK: this.buildRelationshipSk(update.contractId),
            },
          })
        )
      );
    });

    const relatedHoldIds = update.relatedHoldIds ?? [];
    relatedHoldIds.forEach(holdId => {
      updates.push(
        this.client.send(
          new UpdateCommand({
            ...updateRequest,
            Key: {
              PK: this.buildHoldPk(holdId),
              SK: this.buildRelationshipSk(update.contractId),
            },
          })
        )
      );
    });

    if (updates.length) {
      await Promise.all(updates);
    }

    if (update.userId) {
      await this.touchContractPollingMarker({
        userId: update.userId,
        latestUpdatedAt: update.updatedAt,
      });
    }
  }

  async updateContractSummary(update: ContractSummaryUpdate): Promise<void> {
    const prepared = buildContractSummaryUpdateExpressions(update);
    if (!prepared.primaryUpdate) {
      return;
    }

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildContractPk(update.contractId),
          SK: SORT_KEYS.META,
        },
        ...prepared.primaryUpdate,
      })
    );

    if (prepared.shouldWriteSnapshot) {
      await this.saveContractSummarySnapshot(
        buildContractSummarySnapshot(update)
      );
    }

    if (!prepared.metadataUpdate) {
      return;
    }

    const updateRequests: Array<Promise<unknown>> = [];
    const summaryMetaUpdate = {
      TableName: this.tableName,
      ...prepared.metadataUpdate,
    };

    if (update.userId) {
      updateRequests.push(
        this.client.send(
          new UpdateCommand({
            ...summaryMetaUpdate,
            Key: {
              PK: this.buildUserPk(update.userId),
              SK: this.buildUserSk(update.contractId),
            },
          })
        )
      );
    }

    const relatedTransactionIds = update.relatedTransactionIds ?? [];
    relatedTransactionIds.forEach(transactionId => {
      updateRequests.push(
        this.client.send(
          new UpdateCommand({
            ...summaryMetaUpdate,
            Key: {
              PK: this.buildTransactionPk(transactionId),
              SK: this.buildRelationshipSk(update.contractId),
            },
          })
        )
      );
    });

    const relatedHoldIds = update.relatedHoldIds ?? [];
    relatedHoldIds.forEach(holdId => {
      updateRequests.push(
        this.client.send(
          new UpdateCommand({
            ...summaryMetaUpdate,
            Key: {
              PK: this.buildHoldPk(holdId),
              SK: this.buildRelationshipSk(update.contractId),
            },
          })
        )
      );
    });

    if (updateRequests.length) {
      await Promise.all(updateRequests);
    }

    if (update.userId) {
      await this.touchContractPollingMarker({
        userId: update.userId,
        latestUpdatedAt: update.summarySourceUpdatedAt,
      });
    }
  }

  async listContractsByUserId(
    userId: string,
    options?: { updatedSince?: string }
  ): Promise<ContractSummary[]> {
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
      })
    );

    const items = (query.Items ?? []) as ContractUserItem[];
    const getSummaryTimestamp = (item: ContractUserItem) =>
      item.summarySourceUpdatedAt ?? item.summaryUpdatedAt ?? item.updatedAt;
    const updatedSince = options?.updatedSince;
    const filtered = updatedSince
      ? items.filter(item => getSummaryTimestamp(item) > updatedSince)
      : items;
    const hydratedPendingActionFlags = await this.hydratePendingActionFlags(
      filtered
        .filter(item => item.hasPendingAction === undefined)
        .map(item => item.contractId)
    );

    return filtered
      .sort((a, b) =>
        getSummaryTimestamp(b).localeCompare(getSummaryTimestamp(a))
      )
      .map(item => {
        const hasPendingAction =
          item.hasPendingAction ??
          hydratedPendingActionFlags.get(item.contractId);
        return {
          contractId: item.contractId,
          typeBlueId: item.typeBlueId,
          displayName: item.displayName,
          documentName: item.summaryDocumentName ?? item.documentName,
          customerChannelKey: item.customerChannelKey,
          sessionId: item.sessionId,
          documentId: item.documentId,
          status: item.status,
          ...(hasPendingAction !== undefined ? { hasPendingAction } : {}),
          archivedAt: item.archivedAt,
          merchantId: item.merchantId,
          summaryPreview: item.summaryPreview,
          summaryUpdatedAt: item.summaryUpdatedAt,
          summarySourceUpdatedAt: item.summarySourceUpdatedAt,
          summarySourceEpoch: item.summarySourceEpoch,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      });
  }

  async getContractPollingMarkerByUserId(
    userId: string
  ): Promise<ContractPollingMarker> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildUserPk(userId),
          SK: this.buildContractPollMarkerSk(),
        },
        ConsistentRead: true,
      })
    );

    return mapPollingMarkerItem(response.Item);
  }

  async listContractsByTransactionId(
    transactionId: string,
    options?: { userId?: string }
  ): Promise<ContractSummary[]> {
    const query = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ConsistentRead: true,
        ...(options?.userId ? { FilterExpression: '#userId = :userId' } : {}),
        ExpressionAttributeNames: {
          '#pk': 'PK',
          '#sk': 'SK',
          ...(options?.userId ? { '#userId': 'userId' } : {}),
        },
        ExpressionAttributeValues: {
          ':pk': this.buildTransactionPk(transactionId),
          ':skPrefix': RELATIONSHIP_SORT_KEY_PREFIX,
          ...(options?.userId ? { ':userId': options.userId } : {}),
        },
      })
    );

    const items = (query.Items ?? []) as ContractRelationshipItem[];

    const getSummaryTimestamp = (item: ContractRelationshipItem) =>
      item.summarySourceUpdatedAt ?? item.summaryUpdatedAt ?? item.updatedAt;
    const hydratedPendingActionFlags = await this.hydratePendingActionFlags(
      items
        .filter(item => item.hasPendingAction === undefined)
        .map(item => item.contractId)
    );

    return items
      .sort((a, b) =>
        getSummaryTimestamp(b).localeCompare(getSummaryTimestamp(a))
      )
      .map(item => {
        const hasPendingAction =
          item.hasPendingAction ??
          hydratedPendingActionFlags.get(item.contractId);
        return {
          contractId: item.contractId,
          typeBlueId: item.typeBlueId,
          displayName: item.displayName,
          documentName: item.summaryDocumentName ?? item.documentName,
          customerChannelKey: item.customerChannelKey,
          sessionId: item.sessionId,
          documentId: item.documentId,
          status: item.status,
          ...(hasPendingAction !== undefined ? { hasPendingAction } : {}),
          archivedAt: item.archivedAt,
          merchantId: item.merchantId,
          summaryPreview: item.summaryPreview,
          summaryUpdatedAt: item.summaryUpdatedAt,
          summarySourceUpdatedAt: item.summarySourceUpdatedAt,
          summarySourceEpoch: item.summarySourceEpoch,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      });
  }

  async listContractsByHoldId(
    holdId: string,
    options?: { userId?: string }
  ): Promise<ContractSummary[]> {
    const query = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ConsistentRead: true,
        ...(options?.userId ? { FilterExpression: '#userId = :userId' } : {}),
        ExpressionAttributeNames: {
          '#pk': 'PK',
          '#sk': 'SK',
          ...(options?.userId ? { '#userId': 'userId' } : {}),
        },
        ExpressionAttributeValues: {
          ':pk': this.buildHoldPk(holdId),
          ':skPrefix': RELATIONSHIP_SORT_KEY_PREFIX,
          ...(options?.userId ? { ':userId': options.userId } : {}),
        },
      })
    );

    const items = (query.Items ?? []) as ContractRelationshipItem[];

    const getSummaryTimestamp = (item: ContractRelationshipItem) =>
      item.summarySourceUpdatedAt ?? item.summaryUpdatedAt ?? item.updatedAt;
    const hydratedPendingActionFlags = await this.hydratePendingActionFlags(
      items
        .filter(item => item.hasPendingAction === undefined)
        .map(item => item.contractId)
    );

    return items
      .sort((a, b) =>
        getSummaryTimestamp(b).localeCompare(getSummaryTimestamp(a))
      )
      .map(item => {
        const hasPendingAction =
          item.hasPendingAction ??
          hydratedPendingActionFlags.get(item.contractId);
        return {
          contractId: item.contractId,
          typeBlueId: item.typeBlueId,
          displayName: item.displayName,
          documentName: item.summaryDocumentName ?? item.documentName,
          customerChannelKey: item.customerChannelKey,
          sessionId: item.sessionId,
          documentId: item.documentId,
          status: item.status,
          ...(hasPendingAction !== undefined ? { hasPendingAction } : {}),
          archivedAt: item.archivedAt,
          merchantId: item.merchantId,
          summaryPreview: item.summaryPreview,
          summaryUpdatedAt: item.summaryUpdatedAt,
          summarySourceUpdatedAt: item.summarySourceUpdatedAt,
          summarySourceEpoch: item.summarySourceEpoch,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      });
  }
}

export type { ContractRepository } from '../application/ports';
