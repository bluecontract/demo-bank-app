import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoHoldRepository } from './DynamoHoldRepository';
import type {
  ReserveHoldRequest,
  ReleaseHoldRequest,
} from '../application/HoldRepository';
import { hashIdempotencyKey } from '../domain/idempotency';
import { HOLD_ITEM_CONSTANTS } from './dynamo/holds/items';
import { HOLD_IDEMPOTENCY_CONSTANTS } from './dynamo/holds/idempotency';
import { TABLE_PREFIXES, SORT_KEYS } from './dynamo/constants';
import { OptimisticLockError } from './repositoryErrors';

const TEST_CONFIG = {
  tableName: `demo-bank-app-holds-integration-test-${Date.now()}`,
  localstackEndpoint: 'http://localhost:4566',
  region: 'us-east-1',
};

const ACCOUNT_ID = 'acc-123';
const ACCOUNT_NUMBER = '1234567890';
const USER_ID = 'user-1';

let dynamoClient: DynamoDBClient;
let documentClient: DynamoDBDocumentClient;
let repository: DynamoHoldRepository;

async function setupTable() {
  await dynamoClient.send(
    new CreateTableCommand({
      TableName: TEST_CONFIG.tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI1PK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI1SK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI2PK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI2SK', AttributeType: 'S' },
        { AttributeName: HOLD_ITEM_CONSTANTS.GSI1_KEYS.PK, AttributeType: 'S' },
        { AttributeName: HOLD_ITEM_CONSTANTS.GSI1_KEYS.SK, AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'BANKING_GSI1',
          KeySchema: [
            { AttributeName: 'BANKING_GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'BANKING_GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'BANKING_GSI2',
          KeySchema: [
            { AttributeName: 'BANKING_GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'BANKING_GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: HOLD_ITEM_CONSTANTS.GSI_NAMES.HOLD_GSI1,
          KeySchema: [
            {
              AttributeName: HOLD_ITEM_CONSTANTS.GSI1_KEYS.PK,
              KeyType: 'HASH',
            },
            {
              AttributeName: HOLD_ITEM_CONSTANTS.GSI1_KEYS.SK,
              KeyType: 'RANGE',
            },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    })
  );

  let tableReady = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await dynamoClient.send(
      new DescribeTableCommand({ TableName: TEST_CONFIG.tableName })
    );
    if (result.Table?.TableStatus === 'ACTIVE') {
      tableReady = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (!tableReady) {
    throw new Error('DynamoDB table failed to become active');
  }
}

async function cleanupTable() {
  await dynamoClient.send(
    new DeleteTableCommand({ TableName: TEST_CONFIG.tableName })
  );
}

async function clearTableContents() {
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const scanResult = await documentClient.send(
      new ScanCommand({
        TableName: TEST_CONFIG.tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (scanResult.Items && scanResult.Items.length > 0) {
      const items = scanResult.Items;
      type DeleteRequestItem = {
        DeleteRequest: { Key: { PK: string; SK: string } };
      };
      for (let i = 0; i < items.length; i += 25) {
        const chunk = items.slice(i, i + 25);
        let batchItems: DeleteRequestItem[] = chunk.map(item => ({
          DeleteRequest: {
            Key: { PK: item.PK, SK: item.SK },
          },
        }));

        do {
          const batchResult = await documentClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [TEST_CONFIG.tableName]: batchItems,
              },
            })
          );

          const unprocessed =
            batchResult.UnprocessedItems?.[TEST_CONFIG.tableName];
          batchItems = (unprocessed ?? [])
            .map(entry => entry.DeleteRequest?.Key)
            .filter((key): key is { PK: string; SK: string } =>
              Boolean(key?.PK && key?.SK)
            )
            .map(key => ({
              DeleteRequest: { Key: { PK: key.PK, SK: key.SK } },
            }));
        } while (batchItems.length > 0);
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey);
}

async function seedAccount({
  availableBalanceMinor = 10_000,
  ledgerBalanceMinor = 10_000,
  version = 0,
}: {
  availableBalanceMinor?: number;
  ledgerBalanceMinor?: number;
  version?: number;
} = {}) {
  const now = new Date('2024-01-01T00:00:00.000Z').toISOString();
  await documentClient.send(
    new PutCommand({
      TableName: TEST_CONFIG.tableName,
      Item: {
        PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
        SK: SORT_KEYS.META,
        BANKING_GSI1PK: `${TABLE_PREFIXES.USER}${USER_ID}`,
        BANKING_GSI1SK: now,
        BANKING_GSI2PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_NUMBER}`,
        BANKING_GSI2SK: now,
        accountNumber: ACCOUNT_NUMBER,
        name: 'Integration Account',
        ownerUserId: USER_ID,
        status: 'ACTIVE',
        currency: 'USD',
        createdAt: now,
      },
    })
  );

  await documentClient.send(
    new PutCommand({
      TableName: TEST_CONFIG.tableName,
      Item: {
        PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
        SK: SORT_KEYS.BALANCE,
        ledgerBalanceMinor,
        availableBalanceMinor,
        version,
      },
    })
  );
}

function buildReserveRequest({
  holdId,
  holdCreatedAt,
  idempotencyKey,
  amountMinor,
  accountBalanceVersion,
  availableBalanceMinor,
}: {
  holdId: string;
  holdCreatedAt: string;
  idempotencyKey: string;
  amountMinor: number;
  accountBalanceVersion: number;
  availableBalanceMinor: number;
}): ReserveHoldRequest {
  const hold = {
    holdId,
    payerAccountNumber: ACCOUNT_NUMBER,
    amountMinor,
    currency: 'USD' as const,
    status: 'PENDING' as const,
    description: 'Integration hold',
    createdAt: holdCreatedAt,
  };

  const idempotencyKeyHash = hashIdempotencyKey(idempotencyKey);

  return {
    accountId: ACCOUNT_ID,
    accountBalanceVersion,
    availableBalanceMinor,
    amountMinor,
    hold,
    holdEvent: {
      at: holdCreatedAt,
      type: 'CREATED',
      createdByUserId: USER_ID,
      idempotencyKeyHash,
    },
    idempotencyKey,
    idempotencyKeyHash,
    userId: USER_ID,
  };
}

function buildReleaseRequest({
  holdId,
  holdCreatedAt,
  releaseAt,
  idempotencyKey,
  amountMinor,
  accountBalanceVersion,
  availableBalanceMinor,
  reason,
}: {
  holdId: string;
  holdCreatedAt: string;
  releaseAt: string;
  idempotencyKey: string;
  amountMinor: number;
  accountBalanceVersion: number;
  availableBalanceMinor: number;
  reason?: string;
}): ReleaseHoldRequest {
  const hold = {
    holdId,
    payerAccountNumber: ACCOUNT_NUMBER,
    amountMinor,
    currency: 'USD' as const,
    status: 'RELEASED' as const,
    createdAt: holdCreatedAt,
    releasedAt: releaseAt,
    ...(reason ? { releaseReason: reason } : {}),
  };

  const idempotencyKeyHash = hashIdempotencyKey(idempotencyKey);

  return {
    accountId: ACCOUNT_ID,
    accountBalanceVersion,
    availableBalanceMinor,
    amountMinor,
    hold,
    holdEvent: {
      at: releaseAt,
      type: 'RELEASED' as const,
      ...(reason ? { reason } : {}),
    },
    idempotencyKey,
    idempotencyKeyHash,
    userId: USER_ID,
  };
}

describe('DynamoHoldRepository integration', () => {
  beforeAll(async () => {
    dynamoClient = new DynamoDBClient({
      endpoint: TEST_CONFIG.localstackEndpoint,
      region: TEST_CONFIG.region,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    documentClient = DynamoDBDocumentClient.from(dynamoClient);
    await setupTable();
    repository = new DynamoHoldRepository({
      tableName: TEST_CONFIG.tableName,
      region: TEST_CONFIG.region,
      endpoint: TEST_CONFIG.localstackEndpoint,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      documentClient,
    });
  });

  beforeEach(async () => {
    await clearTableContents().catch(() => undefined);
    await seedAccount();
  });

  afterAll(async () => {
    await cleanupTable().catch(() => undefined);
  });

  it('reserves funds and persists hold metadata and events', async () => {
    const amountMinor = 5_000;
    const idempotencyKey = 'reserve-key';
    const holdCreatedAt = '2024-01-02T00:00:00.000Z';
    const request = buildReserveRequest({
      holdId: 'hold-1',
      holdCreatedAt,
      idempotencyKey,
      amountMinor,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });

    const result = await repository.reserveHold(request);

    expect(result.created).toBe(true);
    expect(result.hold).toEqual(request.hold);

    const holdMeta = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${request.hold.holdId}`,
          SK: HOLD_ITEM_CONSTANTS.SORT_KEYS.META,
        },
      })
    );

    expect(holdMeta.Item).toMatchObject({
      holdId: request.hold.holdId,
      status: 'PENDING',
      amountMinor,
      createdAt: holdCreatedAt,
      payerAccountNumber: ACCOUNT_NUMBER,
    });

    const holdEvents = await documentClient.send(
      new QueryCommand({
        TableName: TEST_CONFIG.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${request.hold.holdId}`,
          ':skPrefix': HOLD_ITEM_CONSTANTS.SORT_KEYS.EVENT_PREFIX,
        },
      })
    );

    expect(holdEvents.Items).toHaveLength(1);
    expect(holdEvents.Items?.[0]).toMatchObject({
      type: 'CREATED',
      at: holdCreatedAt,
    });

    const idempotencyRecord = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.USER}${USER_ID}`,
          SK: `${
            HOLD_IDEMPOTENCY_CONSTANTS.SORT_KEY_PREFIX
          }${hashIdempotencyKey(idempotencyKey)}`,
        },
      })
    );

    expect(idempotencyRecord.Item).toMatchObject({
      holdId: request.hold.holdId,
      command: 'RESERVE',
    });

    const balanceItem = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
      })
    );

    expect(balanceItem.Item).toMatchObject({
      availableBalanceMinor: 5_000,
      ledgerBalanceMinor: 10_000,
      version: 1,
    });
  });

  it('returns existing hold on idempotent retry without additional balance changes', async () => {
    const amountMinor = 4_000;
    const idempotencyKey = 'idem-key';
    const initialRequest = buildReserveRequest({
      holdId: 'hold-initial',
      holdCreatedAt: '2024-01-02T01:00:00.000Z',
      idempotencyKey,
      amountMinor,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });

    const firstResult = await repository.reserveHold(initialRequest);
    expect(firstResult.created).toBe(true);

    const balanceAfterFirst = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
      })
    );

    const retryRequest = buildReserveRequest({
      holdId: 'hold-retry',
      holdCreatedAt: '2024-01-02T02:00:00.000Z',
      idempotencyKey,
      amountMinor,
      accountBalanceVersion: balanceAfterFirst.Item!.version,
      availableBalanceMinor: balanceAfterFirst.Item!.availableBalanceMinor,
    });

    const retryResult = await repository.reserveHold(retryRequest);

    expect(retryResult.created).toBe(false);
    expect(retryResult.hold.holdId).toBe(firstResult.hold.holdId);

    const balanceAfterRetry = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
      })
    );

    expect(balanceAfterRetry.Item).toMatchObject({
      availableBalanceMinor: balanceAfterFirst.Item!.availableBalanceMinor,
      version: balanceAfterFirst.Item!.version,
    });

    const holdEvents = await documentClient.send(
      new QueryCommand({
        TableName: TEST_CONFIG.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${initialRequest.hold.holdId}`,
          ':skPrefix': HOLD_ITEM_CONSTANTS.SORT_KEYS.EVENT_PREFIX,
        },
      })
    );

    expect(holdEvents.Items).toHaveLength(1);
  });

  it('throws OptimisticLockError when balance version is stale but funds remain', async () => {
    const initialAmount = 3_000;
    const initialRequest = buildReserveRequest({
      holdId: 'hold-initial-concurrency',
      holdCreatedAt: '2024-01-02T04:00:00.000Z',
      idempotencyKey: 'concurrency-key-initial',
      amountMinor: initialAmount,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });

    const initialResult = await repository.reserveHold(initialRequest);
    expect(initialResult.created).toBe(true);

    const balanceSnapshot = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const staleRequest = buildReserveRequest({
      holdId: 'hold-stale',
      holdCreatedAt: '2024-01-02T05:00:00.000Z',
      idempotencyKey: 'concurrency-key-stale',
      amountMinor: 2_000,
      accountBalanceVersion: 0, // stale version
      availableBalanceMinor: balanceSnapshot.Item!.availableBalanceMinor,
    });

    await expect(repository.reserveHold(staleRequest)).rejects.toBeInstanceOf(
      OptimisticLockError
    );

    const balanceAfterRetry = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    expect(balanceAfterRetry.Item).toMatchObject({
      availableBalanceMinor: balanceSnapshot.Item!.availableBalanceMinor,
      version: balanceSnapshot.Item!.version,
    });

    const staleHold = await repository.getHold(staleRequest.hold.holdId);
    expect(staleHold).toBeNull();
  });

  it('releases hold, restores available balance, and appends event', async () => {
    const reserveRequest = buildReserveRequest({
      holdId: 'hold-release-1',
      holdCreatedAt: '2024-01-02T06:00:00.000Z',
      idempotencyKey: 'release-flow-reserve',
      amountMinor: 3_000,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });

    await repository.reserveHold(reserveRequest);

    const balanceAfterReserve = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const releaseRequest = buildReleaseRequest({
      holdId: reserveRequest.hold.holdId,
      holdCreatedAt: reserveRequest.hold.createdAt,
      releaseAt: '2024-01-02T07:00:00.000Z',
      idempotencyKey: 'release-flow',
      amountMinor: reserveRequest.amountMinor,
      accountBalanceVersion: balanceAfterReserve.Item!.version,
      availableBalanceMinor: balanceAfterReserve.Item!.availableBalanceMinor,
      reason: 'Customer request',
    });

    const releaseResult = await repository.releaseHold(releaseRequest);
    expect(releaseResult.created).toBe(true);
    expect(releaseResult.hold.status).toBe('RELEASED');
    expect(releaseResult.hold.releaseReason).toBe('Customer request');

    const holdMeta = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${releaseRequest.hold.holdId}`,
          SK: HOLD_ITEM_CONSTANTS.SORT_KEYS.META,
        },
      })
    );

    expect(holdMeta.Item).toMatchObject({
      holdId: releaseRequest.hold.holdId,
      status: 'RELEASED',
      releasedAt: '2024-01-02T07:00:00.000Z',
      releaseReason: 'Customer request',
    });

    const holdEvents = await documentClient.send(
      new QueryCommand({
        TableName: TEST_CONFIG.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${releaseRequest.hold.holdId}`,
          ':skPrefix': HOLD_ITEM_CONSTANTS.SORT_KEYS.EVENT_PREFIX,
        },
      })
    );

    expect(holdEvents.Items).toHaveLength(2);
    const releaseEvent = holdEvents.Items?.find(
      item => item.type === 'RELEASED'
    ) as Record<string, unknown> | undefined;
    expect(releaseEvent).toBeDefined();
    expect(releaseEvent?.type).toBe('RELEASED');
    expect(
      (releaseEvent as { payload?: Record<string, unknown> }).payload
    ).toMatchObject({ reason: 'Customer request' });

    const idempotencyRecord = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.USER}${USER_ID}`,
          SK: `${
            HOLD_IDEMPOTENCY_CONSTANTS.SORT_KEY_PREFIX
          }${hashIdempotencyKey('release-flow')}`,
        },
      })
    );

    expect(idempotencyRecord.Item).toMatchObject({
      holdId: releaseRequest.hold.holdId,
      command: 'RELEASE',
    });

    const balanceAfterRelease = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    expect(balanceAfterRelease.Item).toMatchObject({
      availableBalanceMinor: 10_000,
      ledgerBalanceMinor: 10_000,
      version: balanceAfterReserve.Item!.version + 1,
    });
  });

  it('returns existing hold on release idempotent retry without additional changes', async () => {
    const reserveRequest = buildReserveRequest({
      holdId: 'hold-release-2',
      holdCreatedAt: '2024-01-02T08:00:00.000Z',
      idempotencyKey: 'release-retry-reserve',
      amountMinor: 2_500,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });
    await repository.reserveHold(reserveRequest);

    const balanceAfterReserve = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const releaseRequest = buildReleaseRequest({
      holdId: reserveRequest.hold.holdId,
      holdCreatedAt: reserveRequest.hold.createdAt,
      releaseAt: '2024-01-02T09:00:00.000Z',
      idempotencyKey: 'release-retry',
      amountMinor: reserveRequest.amountMinor,
      accountBalanceVersion: balanceAfterReserve.Item!.version,
      availableBalanceMinor: balanceAfterReserve.Item!.availableBalanceMinor,
    });

    const firstRelease = await repository.releaseHold(releaseRequest);
    expect(firstRelease.created).toBe(true);

    const secondRelease = await repository.releaseHold(releaseRequest);
    expect(secondRelease.created).toBe(false);
    expect(secondRelease.hold.status).toBe('RELEASED');

    const holdEvents = await documentClient.send(
      new QueryCommand({
        TableName: TEST_CONFIG.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${releaseRequest.hold.holdId}`,
          ':skPrefix': HOLD_ITEM_CONSTANTS.SORT_KEYS.EVENT_PREFIX,
        },
      })
    );

    expect(holdEvents.Items).toHaveLength(2);

    const balanceAfterRetry = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    expect(balanceAfterRetry.Item).toMatchObject({
      availableBalanceMinor: 10_000,
      ledgerBalanceMinor: 10_000,
    });
  });

  it('throws OptimisticLockError when release uses stale balance version', async () => {
    const reserveRequest = buildReserveRequest({
      holdId: 'hold-release-3',
      holdCreatedAt: '2024-01-02T10:00:00.000Z',
      idempotencyKey: 'release-stale-reserve',
      amountMinor: 1_500,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });
    await repository.reserveHold(reserveRequest);

    const balanceAfterReserve = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const staleRelease = buildReleaseRequest({
      holdId: reserveRequest.hold.holdId,
      holdCreatedAt: reserveRequest.hold.createdAt,
      releaseAt: '2024-01-02T11:00:00.000Z',
      idempotencyKey: 'release-stale',
      amountMinor: reserveRequest.amountMinor,
      accountBalanceVersion: 0,
      availableBalanceMinor: balanceAfterReserve.Item!.availableBalanceMinor,
    });

    await expect(repository.releaseHold(staleRelease)).rejects.toBeInstanceOf(
      OptimisticLockError
    );
  });
});
