import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
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
  ContractSummaryUpdate,
} from '../application/ports';

const ENTITY_TYPES = {
  CONTRACT: 'CONTRACT',
  SESSION: 'CONTRACT_SESSION',
  DOCUMENT: 'CONTRACT_DOCUMENT',
  USER: 'CONTRACT_USER',
} as const;

const TABLE_PREFIXES = {
  CONTRACT: 'CONTRACT#',
  SESSION: 'CONTRACT_SESSION#',
  DOCUMENT: 'CONTRACT_DOCUMENT#',
  USER: 'USER#',
} as const;

const SORT_KEYS = {
  META: 'META',
} as const;

const USER_SORT_KEY_PREFIX = 'CONTRACT#';

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
  statusUpdatedAt?: string;
  statusTimestamps?: Record<string, string>;
  triggerEvent?: unknown;
  emittedEvents?: unknown[];
  relatedTransactionIds?: string[];
  relatedHoldIds?: string[];
  accountNumber?: string;
  userId?: string;
  summary?: ContractDocumentSummary;
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

  private buildUserPk(userId: string) {
    return `${TABLE_PREFIXES.USER}${userId}`;
  }

  private buildUserSk(contractId: string) {
    return `${USER_SORT_KEY_PREFIX}${contractId}`;
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
      statusUpdatedAt: item.statusUpdatedAt,
      statusTimestamps: item.statusTimestamps,
      triggerEvent: item.triggerEvent,
      emittedEvents: item.emittedEvents,
      relatedTransactionIds: item.relatedTransactionIds,
      relatedHoldIds: item.relatedHoldIds,
      accountNumber: item.accountNumber,
      userId: item.userId,
      summary: item.summary,
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
      statusUpdatedAt: record.statusUpdatedAt,
      statusTimestamps: record.statusTimestamps,
      triggerEvent: record.triggerEvent,
      emittedEvents: record.emittedEvents,
      relatedTransactionIds: record.relatedTransactionIds,
      relatedHoldIds: record.relatedHoldIds,
      accountNumber: record.accountNumber,
      userId: record.userId,
      summary: record.summary,
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
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
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
    const updatedSince = options?.updatedSince;
    const filtered = updatedSince
      ? items.filter(item => item.updatedAt > updatedSince)
      : items;

    return filtered
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(item => ({
        contractId: item.contractId,
        typeBlueId: item.typeBlueId,
        displayName: item.displayName,
        documentName: item.documentName,
        sessionId: item.sessionId,
        documentId: item.documentId,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }
}

export type { ContractRepository } from '../application/ports';
