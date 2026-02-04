import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type {
  ContractRecord,
  ContractRepository,
  ContractSummary,
  ContractDocumentSummary,
  ContractHistoryEntry,
  ContractHistoryEntryInput,
  ContractSummaryUpdate,
  ContractArchiveUpdate,
} from '../application/ports';

const ENTITY_TYPES = {
  CONTRACT: 'CONTRACT',
  SESSION: 'CONTRACT_SESSION',
  DOCUMENT: 'CONTRACT_DOCUMENT',
  USER: 'CONTRACT_USER',
  RELATIONSHIP: 'CONTRACT_RELATIONSHIP',
  HISTORY: 'CONTRACT_HISTORY',
} as const;

const TABLE_PREFIXES = {
  CONTRACT: 'CONTRACT#',
  SESSION: 'CONTRACT_SESSION#',
  DOCUMENT: 'CONTRACT_DOCUMENT#',
  USER: 'USER#',
  TRANSACTION: 'TXN#',
  HOLD: 'HOLD#',
} as const;

const SORT_KEYS = {
  META: 'META',
} as const;

const USER_SORT_KEY_PREFIX = 'CONTRACT#';
const RELATIONSHIP_SORT_KEY_PREFIX = 'CONTRACT#';
const HISTORY_SORT_KEY_PREFIX = 'HISTORY#';

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
  summary?: ContractDocumentSummary;
  summaryPreview?: string;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  summaryInputBlueId?: string;
  summaryModel?: string;
  summaryError?: string;
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

interface ContractUserItem {
  PK: string;
  SK: string;
  entityType: typeof ENTITY_TYPES.USER;
  contractId: string;
  typeBlueId: string;
  displayName: string;
  documentName?: string;
  sessionId?: string;
  documentId?: string;
  status?: string;
  archivedAt?: string;
  summaryPreview?: string;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
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
  sessionId?: string;
  documentId?: string;
  status?: string;
  userId?: string;
  archivedAt?: string;
  summaryPreview?: string;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
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

  private buildUserPk(userId: string) {
    return `${TABLE_PREFIXES.USER}${userId}`;
  }

  private buildUserSk(contractId: string) {
    return `${USER_SORT_KEY_PREFIX}${contractId}`;
  }

  private buildTransactionPk(transactionId: string) {
    return `${TABLE_PREFIXES.TRANSACTION}${transactionId}`;
  }

  private buildHoldPk(holdId: string) {
    return `${TABLE_PREFIXES.HOLD}${holdId}`;
  }

  private buildRelationshipSk(contractId: string) {
    return `${RELATIONSHIP_SORT_KEY_PREFIX}${contractId}`;
  }

  private buildHistorySk(createdAt: string, historyId: string) {
    return `${HISTORY_SORT_KEY_PREFIX}${createdAt}#${historyId}`;
  }

  private mapItemToRecord(item: ContractItem): ContractRecord {
    return {
      contractId: item.contractId,
      typeBlueId: item.typeBlueId,
      displayName: item.displayName,
      documentName: item.documentName,
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
      summary: item.summary,
      summaryPreview: item.summaryPreview,
      summaryUpdatedAt: item.summaryUpdatedAt,
      summarySourceUpdatedAt: item.summarySourceUpdatedAt,
      summaryInputBlueId: item.summaryInputBlueId,
      summaryModel: item.summaryModel,
      summaryError: item.summaryError,
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
      })
    );

    if (!response.Item) {
      return null;
    }

    return this.mapItemToRecord(response.Item as ContractItem);
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
      })
    );

    const contractId = (response.Item as ContractSessionItem | undefined)
      ?.contractId;
    if (!contractId) {
      return null;
    }

    return this.getContract(contractId);
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
      })
    );

    const contractId = (response.Item as ContractDocumentItem | undefined)
      ?.contractId;
    if (!contractId) {
      return null;
    }

    return this.getContract(contractId);
  }

  async saveContract(record: ContractRecord): Promise<void> {
    const item: ContractItem = {
      PK: this.buildContractPk(record.contractId),
      SK: SORT_KEYS.META,
      entityType: ENTITY_TYPES.CONTRACT,
      contractId: record.contractId,
      typeBlueId: record.typeBlueId,
      displayName: record.displayName,
      documentName: record.documentName,
      sessionId: record.sessionId,
      documentId: record.documentId,
      document: record.document,
      status: record.status,
      archivedAt: record.archivedAt,
      statusUpdatedAt: record.statusUpdatedAt,
      statusTimestamps: record.statusTimestamps,
      triggerEvent: record.triggerEvent,
      emittedEvents: record.emittedEvents,
      relatedTransactionIds: record.relatedTransactionIds,
      relatedHoldIds: record.relatedHoldIds,
      accountNumber: record.accountNumber,
      userId: record.userId,
      summary: record.summary,
      summaryPreview: record.summaryPreview ?? record.summary?.listPreview,
      summaryUpdatedAt: record.summaryUpdatedAt,
      summarySourceUpdatedAt: record.summarySourceUpdatedAt,
      summaryInputBlueId: record.summaryInputBlueId,
      summaryModel: record.summaryModel,
      summaryError: record.summaryError,
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
          new PutCommand({ TableName: this.tableName, Item: documentItem })
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
        sessionId: record.sessionId,
        documentId: record.documentId,
        status: record.status,
        archivedAt: record.archivedAt,
        summaryPreview: record.summaryPreview ?? record.summary?.listPreview,
        summaryUpdatedAt: record.summaryUpdatedAt,
        summarySourceUpdatedAt: record.summarySourceUpdatedAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      writes.push(
        this.client.send(
          new PutCommand({ TableName: this.tableName, Item: userItem })
        )
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
      sessionId: record.sessionId,
      documentId: record.documentId,
      status: record.status,
      userId: record.userId,
      archivedAt: record.archivedAt,
      summaryPreview: record.summaryPreview ?? record.summary?.listPreview,
      summaryUpdatedAt: record.summaryUpdatedAt,
      summarySourceUpdatedAt: record.summarySourceUpdatedAt,
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
  }

  async updateContractSummary(update: ContractSummaryUpdate): Promise<void> {
    const setters: string[] = [];
    const removals: string[] = [];
    const names: Record<string, string> = {
      '#pk': 'PK',
    };
    const values: Record<string, unknown> = {};

    const addValue = (key: string, value: unknown) => {
      values[key] = value;
      return key;
    };

    const addName = (key: string, value: string) => {
      names[key] = value;
      return key;
    };

    const setField = (nameKey: string, valueKey: string, value: unknown) => {
      addValue(valueKey, value);
      setters.push(`${nameKey} = ${valueKey}`);
    };

    const summaryPreview = update.summary?.listPreview ?? update.summaryPreview;
    const shouldRemoveSummaryPreview =
      update.summary === null || update.summaryPreview === null;

    const handleField = (
      nameKey: string,
      attributeName: string,
      valueKey: string,
      value: unknown | null | undefined
    ) => {
      if (value === undefined) {
        return;
      }
      addName(nameKey, attributeName);
      if (value === null) {
        removals.push(nameKey);
        return;
      }
      setField(nameKey, valueKey, value);
    };

    handleField('#summary', 'summary', ':summary', update.summary);
    handleField(
      '#summaryPreview',
      'summaryPreview',
      ':summaryPreview',
      shouldRemoveSummaryPreview ? null : summaryPreview
    );
    handleField(
      '#summaryUpdatedAt',
      'summaryUpdatedAt',
      ':summaryUpdatedAt',
      update.summaryUpdatedAt
    );
    handleField(
      '#summarySourceUpdatedAt',
      'summarySourceUpdatedAt',
      ':summarySourceUpdatedAt',
      update.summarySourceUpdatedAt
    );
    handleField(
      '#summaryInputBlueId',
      'summaryInputBlueId',
      ':summaryInputBlueId',
      update.summaryInputBlueId
    );
    handleField(
      '#summaryModel',
      'summaryModel',
      ':summaryModel',
      update.summaryModel
    );
    handleField(
      '#summaryError',
      'summaryError',
      ':summaryError',
      update.summaryError
    );

    if (!setters.length && !removals.length) {
      return;
    }

    const expressions: string[] = [];
    if (setters.length) {
      expressions.push(`SET ${setters.join(', ')}`);
    }
    if (removals.length) {
      expressions.push(`REMOVE ${removals.join(', ')}`);
    }

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildContractPk(update.contractId),
          SK: SORT_KEYS.META,
        },
        ConditionExpression: 'attribute_exists(#pk)',
        UpdateExpression: expressions.join(' '),
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length
          ? { ExpressionAttributeValues: values }
          : {}),
      })
    );

    const summaryMetaSetters: string[] = [];
    const summaryMetaRemovals: string[] = [];
    const summaryMetaNames: Record<string, string> = {
      '#pk': 'PK',
    };
    const summaryMetaValues: Record<string, unknown> = {};

    const setSummaryMetaField = (
      nameKey: string,
      attributeName: string,
      valueKey: string,
      value: unknown | null | undefined
    ) => {
      if (value === undefined) {
        return;
      }
      summaryMetaNames[nameKey] = attributeName;
      if (value === null) {
        summaryMetaRemovals.push(nameKey);
        return;
      }
      summaryMetaValues[valueKey] = value;
      summaryMetaSetters.push(`${nameKey} = ${valueKey}`);
    };

    setSummaryMetaField(
      '#summaryPreview',
      'summaryPreview',
      ':summaryPreview',
      shouldRemoveSummaryPreview ? null : summaryPreview
    );
    setSummaryMetaField(
      '#summaryUpdatedAt',
      'summaryUpdatedAt',
      ':summaryUpdatedAt',
      update.summaryUpdatedAt
    );
    setSummaryMetaField(
      '#summarySourceUpdatedAt',
      'summarySourceUpdatedAt',
      ':summarySourceUpdatedAt',
      update.summarySourceUpdatedAt
    );

    if (!summaryMetaSetters.length && !summaryMetaRemovals.length) {
      return;
    }

    const summaryMetaExpressions: string[] = [];
    if (summaryMetaSetters.length) {
      summaryMetaExpressions.push(`SET ${summaryMetaSetters.join(', ')}`);
    }
    if (summaryMetaRemovals.length) {
      summaryMetaExpressions.push(`REMOVE ${summaryMetaRemovals.join(', ')}`);
    }

    const updateRequests: Array<Promise<unknown>> = [];
    const summaryMetaUpdate = {
      TableName: this.tableName,
      ConditionExpression: 'attribute_exists(#pk)',
      UpdateExpression: summaryMetaExpressions.join(' '),
      ExpressionAttributeNames: summaryMetaNames,
      ...(Object.keys(summaryMetaValues).length
        ? { ExpressionAttributeValues: summaryMetaValues }
        : {}),
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
  }

  async listContractsByUserId(
    userId: string,
    options?: { updatedSince?: string }
  ): Promise<ContractSummary[]> {
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
      })
    );

    const items = (query.Items ?? []) as ContractUserItem[];
    const getSummaryTimestamp = (item: ContractUserItem) =>
      item.summarySourceUpdatedAt ?? item.summaryUpdatedAt ?? item.updatedAt;
    const updatedSince = options?.updatedSince;
    const filtered = updatedSince
      ? items.filter(item => getSummaryTimestamp(item) > updatedSince)
      : items;

    return filtered
      .sort((a, b) =>
        getSummaryTimestamp(b).localeCompare(getSummaryTimestamp(a))
      )
      .map(item => ({
        contractId: item.contractId,
        typeBlueId: item.typeBlueId,
        displayName: item.displayName,
        documentName: item.documentName,
        sessionId: item.sessionId,
        documentId: item.documentId,
        status: item.status,
        archivedAt: item.archivedAt,
        summaryPreview: item.summaryPreview,
        summaryUpdatedAt: item.summaryUpdatedAt,
        summarySourceUpdatedAt: item.summarySourceUpdatedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  async listContractsByTransactionId(
    transactionId: string,
    options?: { userId?: string }
  ): Promise<ContractSummary[]> {
    const query = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
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

    return items
      .sort((a, b) =>
        getSummaryTimestamp(b).localeCompare(getSummaryTimestamp(a))
      )
      .map(item => ({
        contractId: item.contractId,
        typeBlueId: item.typeBlueId,
        displayName: item.displayName,
        documentName: item.documentName,
        sessionId: item.sessionId,
        documentId: item.documentId,
        status: item.status,
        archivedAt: item.archivedAt,
        summaryPreview: item.summaryPreview,
        summaryUpdatedAt: item.summaryUpdatedAt,
        summarySourceUpdatedAt: item.summarySourceUpdatedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  async listContractsByHoldId(
    holdId: string,
    options?: { userId?: string }
  ): Promise<ContractSummary[]> {
    const query = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
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

    return items
      .sort((a, b) =>
        getSummaryTimestamp(b).localeCompare(getSummaryTimestamp(a))
      )
      .map(item => ({
        contractId: item.contractId,
        typeBlueId: item.typeBlueId,
        displayName: item.displayName,
        documentName: item.documentName,
        sessionId: item.sessionId,
        documentId: item.documentId,
        status: item.status,
        archivedAt: item.archivedAt,
        summaryPreview: item.summaryPreview,
        summaryUpdatedAt: item.summaryUpdatedAt,
        summarySourceUpdatedAt: item.summarySourceUpdatedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }
}

export type { ContractRepository } from '../application/ports';
