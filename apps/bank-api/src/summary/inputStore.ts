import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type { ContractRecord } from '@demo-bank-app/contracts';

const SUMMARY_INPUT_SK_PREFIX = 'SUMMARY_INPUT#';
const SUMMARY_INPUT_RETENTION_SECONDS = 60 * 60 * 24 * 14;

type DynamoContractSummaryInputStoreConfig = {
  tableName: string;
  region: string;
  endpoint?: string;
};

type ContractSummaryInputItem = {
  PK: string;
  SK: string;
  entityType: 'CONTRACT_SUMMARY_INPUT';
  contractId: string;
  sourceUpdatedAt: string;
  sourceEpoch?: number;
  eventId?: string;
  contractSnapshot?: ContractRecord;
  createdAt: string;
  ttl?: number;
};

export type ContractSummaryInputSnapshot = {
  contractId: string;
  summaryInputKey: string;
  sourceUpdatedAt: string;
  sourceEpoch?: number;
  eventId?: string;
  contractSnapshot?: ContractRecord;
  createdAt: string;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toEpochMs = (value: number): number | null => {
  if (!isFiniteNumber(value)) {
    return null;
  }
  if (value > 1e14) {
    return Math.round(value / 1000);
  }
  if (value > 1e11) {
    return Math.round(value);
  }
  if (value > 1e9) {
    return Math.round(value * 1000);
  }
  return null;
};

export const normalizeSourceUpdatedAt = (
  sourceUpdatedAt: unknown,
  fallback: string
): string => {
  if (typeof sourceUpdatedAt === 'string') {
    const parsed = Date.parse(sourceUpdatedAt);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  if (isFiniteNumber(sourceUpdatedAt)) {
    const epochMs = toEpochMs(sourceUpdatedAt);
    if (epochMs !== null) {
      const iso = new Date(epochMs).toISOString();
      if (!Number.isNaN(Date.parse(iso))) {
        return iso;
      }
    }
  }

  return fallback;
};

export const buildSummaryInputKey = (input: {
  sourceUpdatedAt: string;
  sourceEpoch?: number;
}): string => {
  const { sourceUpdatedAt, sourceEpoch } = input;
  return sourceEpoch === undefined
    ? `${SUMMARY_INPUT_SK_PREFIX}${sourceUpdatedAt}`
    : `${SUMMARY_INPUT_SK_PREFIX}${sourceUpdatedAt}#${sourceEpoch}`;
};

export const buildContractSummaryInputSnapshot = (input: {
  contractId: string;
  sourceUpdatedAt: string;
  sourceEpoch?: number;
  eventId?: string;
  contractSnapshot?: ContractRecord;
  createdAt: string;
}): ContractSummaryInputSnapshot => {
  const summaryInputKey = buildSummaryInputKey({
    sourceUpdatedAt: input.sourceUpdatedAt,
    sourceEpoch: input.sourceEpoch,
  });

  return {
    contractId: input.contractId,
    summaryInputKey,
    sourceUpdatedAt: input.sourceUpdatedAt,
    sourceEpoch: input.sourceEpoch,
    eventId: input.eventId,
    ...(input.contractSnapshot
      ? { contractSnapshot: input.contractSnapshot }
      : {}),
    createdAt: input.createdAt,
  };
};

export class DynamoContractSummaryInputStore {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(config: DynamoContractSummaryInputStoreConfig) {
    this.tableName = config.tableName;
    const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
    const dynamoClient = new DynamoDBClient({
      region: config.region,
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig),
    });
    this.client = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }

  private buildContractPk(contractId: string) {
    return `CONTRACT#${contractId}`;
  }

  async save(snapshot: ContractSummaryInputSnapshot): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + SUMMARY_INPUT_RETENTION_SECONDS;
    const item: ContractSummaryInputItem = {
      PK: this.buildContractPk(snapshot.contractId),
      SK: snapshot.summaryInputKey,
      entityType: 'CONTRACT_SUMMARY_INPUT',
      contractId: snapshot.contractId,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      ...(snapshot.sourceEpoch !== undefined
        ? { sourceEpoch: snapshot.sourceEpoch }
        : {}),
      ...(snapshot.eventId ? { eventId: snapshot.eventId } : {}),
      ...(snapshot.contractSnapshot
        ? { contractSnapshot: snapshot.contractSnapshot }
        : {}),
      createdAt: snapshot.createdAt,
      ttl,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  async get(input: {
    contractId: string;
    summaryInputKey: string;
  }): Promise<ContractSummaryInputSnapshot | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: this.buildContractPk(input.contractId),
          SK: input.summaryInputKey,
        },
        ConsistentRead: true,
      })
    );

    const item = response.Item as ContractSummaryInputItem | undefined;
    if (!item) {
      return null;
    }

    return {
      contractId: item.contractId,
      summaryInputKey: item.SK,
      sourceUpdatedAt: item.sourceUpdatedAt,
      sourceEpoch: item.sourceEpoch,
      eventId: item.eventId,
      contractSnapshot: item.contractSnapshot,
      createdAt: item.createdAt,
    };
  }
}
