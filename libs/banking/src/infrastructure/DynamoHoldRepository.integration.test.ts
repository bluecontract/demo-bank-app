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
  CaptureHoldRequest,
} from '../application/HoldRepository';
import { hashIdempotencyKey } from '../domain/idempotency';
import { buildHoldIdempotencySortKey } from './dynamo/holds/idempotency';
import { HOLD_ITEM_CONSTANTS } from './dynamo/holds/items';
import { TABLE_PREFIXES, SORT_KEYS } from './dynamo/constants';
import { OptimisticLockError } from './repositoryErrors';
import { Transaction } from '../domain/entities/Transaction';
import { Posting } from '../domain/valueObjects/Posting';
import { Money } from '../domain/valueObjects/Money';

const resolveLocalstackEndpoint = () => {
  const envEndpoint =
    process.env.AWS_ENDPOINT_URL?.trim() ||
    process.env.LOCALSTACK_ENDPOINT_URL?.trim();
  if (envEndpoint) {
    return envEndpoint;
  }

  const port = process.env.LOCALSTACK_EDGE_PORT?.trim() || '4566';
  return `http://localhost:${port}`;
};

const TEST_CONFIG = {
  tableName: `demo-bank-app-holds-integration-test-${Date.now()}`,
  localstackEndpoint: resolveLocalstackEndpoint(),
  region: 'us-east-1',
};

const ACCOUNT_ID = 'acc-123';
const ACCOUNT_NUMBER = '1234567890';
const USER_ID = 'user-1';
const COUNTERPARTY_ACCOUNT_ID = 'acc-456';
const COUNTERPARTY_ACCOUNT_NUMBER = '5555555555';
const COUNTERPARTY_USER_ID = 'user-2';

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
        {
          AttributeName: HOLD_ITEM_CONSTANTS.HOLD_EVENT_GSI1_KEYS.PK,
          AttributeType: 'S',
        },
        {
          AttributeName: HOLD_ITEM_CONSTANTS.HOLD_EVENT_GSI1_KEYS.SK,
          AttributeType: 'S',
        },
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
        {
          IndexName: HOLD_ITEM_CONSTANTS.GSI_NAMES.HOLD_EVENT_GSI1,
          KeySchema: [
            {
              AttributeName: HOLD_ITEM_CONSTANTS.HOLD_EVENT_GSI1_KEYS.PK,
              KeyType: 'HASH',
            },
            {
              AttributeName: HOLD_ITEM_CONSTANTS.HOLD_EVENT_GSI1_KEYS.SK,
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

async function seedCounterpartyAccount({
  availableBalanceMinor = 15_000,
  ledgerBalanceMinor = 15_000,
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
        PK: `${TABLE_PREFIXES.ACCOUNT}${COUNTERPARTY_ACCOUNT_ID}`,
        SK: SORT_KEYS.META,
        BANKING_GSI1PK: `${TABLE_PREFIXES.USER}${COUNTERPARTY_USER_ID}`,
        BANKING_GSI1SK: now,
        BANKING_GSI2PK: `${TABLE_PREFIXES.ACCOUNT}${COUNTERPARTY_ACCOUNT_NUMBER}`,
        BANKING_GSI2SK: now,
        accountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
        name: 'Counterparty Account',
        ownerUserId: COUNTERPARTY_USER_ID,
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
        PK: `${TABLE_PREFIXES.ACCOUNT}${COUNTERPARTY_ACCOUNT_ID}`,
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
  counterpartyAccountNumber = COUNTERPARTY_ACCOUNT_NUMBER,
}: {
  holdId: string;
  holdCreatedAt: string;
  idempotencyKey: string;
  amountMinor: number;
  accountBalanceVersion: number;
  availableBalanceMinor: number;
  counterpartyAccountNumber?: string;
}): ReserveHoldRequest {
  const hold = {
    holdId,
    payerAccountNumber: ACCOUNT_NUMBER,
    counterpartyAccountNumber,
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

function buildCaptureRequest({
  holdId,
  holdCreatedAt,
  captureAt,
  idempotencyKey,
  amountMinor,
  payerAccountVersion,
  counterpartyAccountVersion,
}: {
  holdId: string;
  holdCreatedAt: string;
  captureAt: string;
  idempotencyKey: string;
  amountMinor: number;
  payerAccountVersion: number;
  counterpartyAccountVersion: number;
}): CaptureHoldRequest {
  const debit = new Posting({
    accountId: ACCOUNT_ID,
    amount: new Money(amountMinor),
    side: 'DEBIT',
    accountNumber: ACCOUNT_NUMBER,
    counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
  });

  const credit = new Posting({
    accountId: COUNTERPARTY_ACCOUNT_ID,
    amount: new Money(amountMinor),
    side: 'CREDIT',
    accountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
    counterpartyAccountNumber: ACCOUNT_NUMBER,
  });

  const transactionId = `txn-${holdId}`;
  const transaction = Transaction.createWithId(
    [debit, credit],
    {
      idempotencyKey,
      description: `Capture hold ${holdId}`,
      originHoldId: holdId,
    },
    transactionId
  );

  const hold = {
    holdId,
    payerAccountNumber: ACCOUNT_NUMBER,
    counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
    amountMinor,
    currency: 'USD' as const,
    status: 'CAPTURED' as const,
    description: 'Integration hold capture',
    createdAt: holdCreatedAt,
    relatedTransactionId: transaction.id,
  };

  const idempotencyKeyHash = hashIdempotencyKey(idempotencyKey);

  return {
    payerAccountId: ACCOUNT_ID,
    payerAccountBalanceVersion: payerAccountVersion,
    counterpartyAccountId: COUNTERPARTY_ACCOUNT_ID,
    counterpartyAccountBalanceVersion: counterpartyAccountVersion,
    hold,
    holdEvent: {
      at: captureAt,
      type: 'CAPTURED' as const,
      transactionId: transaction.id,
      counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
    },
    transaction,
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
    await seedCounterpartyAccount();
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
          SK: buildHoldIdempotencySortKey('RESERVE', idempotencyKey),
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
          SK: buildHoldIdempotencySortKey('RELEASE', 'release-flow'),
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

  it('captures hold, posts transaction, and links hold to transaction', async () => {
    const amountMinor = 4_000;
    const holdId = 'hold-capture-integration';
    const reserveRequest = buildReserveRequest({
      holdId,
      holdCreatedAt: '2024-01-03T00:00:00.000Z',
      idempotencyKey: 'reserve-for-capture',
      amountMinor,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });

    await repository.reserveHold(reserveRequest);

    const payerBalanceAfterReserve = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const counterpartyBalanceBeforeCapture = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${COUNTERPARTY_ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const captureRequest = buildCaptureRequest({
      holdId,
      holdCreatedAt: reserveRequest.hold.createdAt,
      captureAt: '2024-01-04T00:00:00.000Z',
      idempotencyKey: 'capture-hold',
      amountMinor,
      payerAccountVersion: payerBalanceAfterReserve.Item!.version,
      counterpartyAccountVersion:
        counterpartyBalanceBeforeCapture.Item!.version,
    });

    const captureResult = await repository.captureHold(captureRequest);

    expect(captureResult.created).toBe(true);
    expect(captureResult.transactionId).toBe(captureRequest.transaction.id);

    const holdMeta = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${holdId}`,
          SK: HOLD_ITEM_CONSTANTS.SORT_KEYS.META,
        },
      })
    );

    expect(holdMeta.Item).toMatchObject({
      holdId,
      status: 'CAPTURED',
      relatedTransactionId: captureRequest.transaction.id,
    });

    const holdEvents = await documentClient.send(
      new QueryCommand({
        TableName: TEST_CONFIG.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `${HOLD_ITEM_CONSTANTS.TABLE_PREFIXES.HOLD}${holdId}`,
          ':skPrefix': HOLD_ITEM_CONSTANTS.SORT_KEYS.EVENT_PREFIX,
        },
      })
    );

    expect(holdEvents.Items).toHaveLength(2);
    const captureEvent = holdEvents.Items?.find(
      item => item.type === 'CAPTURED'
    ) as Record<string, unknown> | undefined;
    expect(captureEvent).toBeDefined();
    expect(captureEvent?.payload).toMatchObject({
      transactionId: captureRequest.transaction.id,
      counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
    });

    const transactionHeader = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.TRANSACTION}${captureRequest.transaction.id}`,
          SK: SORT_KEYS.META,
        },
      })
    );

    expect(transactionHeader.Item).toMatchObject({
      transactionId: captureRequest.transaction.id,
      originHoldId: holdId,
    });

    const postings = await documentClient.send(
      new QueryCommand({
        TableName: TEST_CONFIG.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `${TABLE_PREFIXES.TRANSACTION}${captureRequest.transaction.id}`,
          ':skPrefix': TABLE_PREFIXES.POSTING,
        },
      })
    );

    expect(postings.Items).toHaveLength(2);
    const debitPosting = postings.Items?.find(
      item => item.accountId === ACCOUNT_ID
    ) as Record<string, unknown> | undefined;
    const creditPosting = postings.Items?.find(
      item => item.accountId === COUNTERPARTY_ACCOUNT_ID
    ) as Record<string, unknown> | undefined;
    expect(debitPosting?.amount).toBe(amountMinor);
    expect(creditPosting?.amount).toBe(amountMinor);

    const idempotencyRecord = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.USER}${USER_ID}`,
          SK: buildHoldIdempotencySortKey('CAPTURE', 'capture-hold'),
        },
      })
    );

    expect(idempotencyRecord.Item).toMatchObject({
      holdId,
      command: 'CAPTURE',
      transactionId: captureRequest.transaction.id,
    });

    const payerBalanceAfterCapture = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    expect(payerBalanceAfterCapture.Item).toMatchObject({
      ledgerBalanceMinor: 10_000 - amountMinor,
      availableBalanceMinor: 10_000 - amountMinor,
      version: payerBalanceAfterReserve.Item!.version + 1,
    });

    const counterpartyBalanceAfterCapture = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${COUNTERPARTY_ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    expect(counterpartyBalanceAfterCapture.Item).toMatchObject({
      ledgerBalanceMinor:
        counterpartyBalanceBeforeCapture.Item!.ledgerBalanceMinor + amountMinor,
      availableBalanceMinor:
        counterpartyBalanceBeforeCapture.Item!.availableBalanceMinor +
        amountMinor,
      version: counterpartyBalanceBeforeCapture.Item!.version + 1,
    });
  });

  it('retries capture idempotently returning existing transaction information', async () => {
    const amountMinor = 5_000;
    const holdId = 'hold-capture-retry';
    const reserveRequest = buildReserveRequest({
      holdId,
      holdCreatedAt: '2024-01-05T00:00:00.000Z',
      idempotencyKey: 'reserve-for-capture-retry',
      amountMinor,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });

    await repository.reserveHold(reserveRequest);

    const payerBalanceAfterReserve = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const counterpartyBalanceBeforeCapture = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${COUNTERPARTY_ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const captureRequest = buildCaptureRequest({
      holdId,
      holdCreatedAt: reserveRequest.hold.createdAt,
      captureAt: '2024-01-05T01:00:00.000Z',
      idempotencyKey: 'capture-retry',
      amountMinor,
      payerAccountVersion: payerBalanceAfterReserve.Item!.version,
      counterpartyAccountVersion:
        counterpartyBalanceBeforeCapture.Item!.version,
    });

    const firstCapture = await repository.captureHold(captureRequest);
    expect(firstCapture.created).toBe(true);

    const payerBalanceAfterCapture = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const counterpartyBalanceAfterCapture = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${COUNTERPARTY_ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const retryRequest: CaptureHoldRequest = {
      ...captureRequest,
      payerAccountBalanceVersion: payerBalanceAfterCapture.Item!.version,
      counterpartyAccountBalanceVersion:
        counterpartyBalanceAfterCapture.Item!.version,
    };

    const retryCapture = await repository.captureHold(retryRequest);

    expect(retryCapture.created).toBe(false);
    expect(retryCapture.transactionId).toBe(captureRequest.transaction.id);

    const postings = await documentClient.send(
      new QueryCommand({
        TableName: TEST_CONFIG.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `${TABLE_PREFIXES.TRANSACTION}${captureRequest.transaction.id}`,
          ':skPrefix': TABLE_PREFIXES.POSTING,
        },
      })
    );

    expect(postings.Items).toHaveLength(2);
  });

  it('only allows capture or release to succeed when executed concurrently', async () => {
    const amountMinor = 3_500;
    const holdId = 'hold-capture-release-race';
    const reserveRequest = buildReserveRequest({
      holdId,
      holdCreatedAt: '2024-01-06T00:00:00.000Z',
      idempotencyKey: 'race-reserve',
      amountMinor,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });

    await repository.reserveHold(reserveRequest);

    const payerBalanceAfterReserve = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const counterpartyBalanceBeforeCapture = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${COUNTERPARTY_ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const captureRequest = buildCaptureRequest({
      holdId,
      holdCreatedAt: reserveRequest.hold.createdAt,
      captureAt: '2024-01-06T01:00:00.000Z',
      idempotencyKey: 'race-capture',
      amountMinor,
      payerAccountVersion: payerBalanceAfterReserve.Item!.version,
      counterpartyAccountVersion:
        counterpartyBalanceBeforeCapture.Item!.version,
    });

    const releaseRequest = buildReleaseRequest({
      holdId,
      holdCreatedAt: reserveRequest.hold.createdAt,
      releaseAt: '2024-01-06T01:00:00.000Z',
      idempotencyKey: 'race-release',
      amountMinor,
      accountBalanceVersion: payerBalanceAfterReserve.Item!.version,
      availableBalanceMinor:
        payerBalanceAfterReserve.Item!.availableBalanceMinor,
    });

    const [captureOutcome, releaseOutcome] = await Promise.allSettled([
      repository.captureHold(captureRequest),
      repository.releaseHold(releaseRequest),
    ]);

    const successes = [captureOutcome, releaseOutcome].filter(
      outcome => outcome.status === 'fulfilled'
    );

    expect(successes).toHaveLength(1);

    const hold = await repository.getHold(holdId);
    expect(hold?.status === 'CAPTURED' || hold?.status === 'RELEASED').toBe(
      true
    );

    const failures = [captureOutcome, releaseOutcome].filter(
      outcome => outcome.status === 'rejected'
    ) as PromiseRejectedResult[];
    if (failures.length > 0) {
      expect(failures[0].reason).toBeInstanceOf(OptimisticLockError);
    }
  });

  it('fails capture when counterparty does not match existing hold counterparty', async () => {
    const amountMinor = 2_000;
    const holdId = 'hold-capture-mismatch';
    const reserveRequest = buildReserveRequest({
      holdId,
      holdCreatedAt: '2024-01-07T00:00:00.000Z',
      idempotencyKey: 'reserve-mismatch',
      amountMinor,
      accountBalanceVersion: 0,
      availableBalanceMinor: 10_000,
    });

    await repository.reserveHold(reserveRequest);

    const payerBalanceAfterReserve = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const counterpartyBalanceBeforeCapture = await documentClient.send(
      new GetCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: `${TABLE_PREFIXES.ACCOUNT}${COUNTERPARTY_ACCOUNT_ID}`,
          SK: SORT_KEYS.BALANCE,
        },
        ConsistentRead: true,
      })
    );

    const captureRequest = buildCaptureRequest({
      holdId,
      holdCreatedAt: reserveRequest.hold.createdAt,
      captureAt: '2024-01-07T01:00:00.000Z',
      idempotencyKey: 'capture-mismatch',
      amountMinor,
      payerAccountVersion: payerBalanceAfterReserve.Item!.version,
      counterpartyAccountVersion:
        counterpartyBalanceBeforeCapture.Item!.version,
    });

    captureRequest.hold = {
      ...captureRequest.hold,
      counterpartyAccountNumber: '9999999999',
    };
    captureRequest.holdEvent = {
      ...captureRequest.holdEvent,
      counterpartyAccountNumber: '9999999999',
    };

    await expect(repository.captureHold(captureRequest)).rejects.toBeInstanceOf(
      OptimisticLockError
    );

    const holdAfterFailure = await repository.getHold(holdId);
    expect(holdAfterFailure?.status).toBe('PENDING');
  });

  it('lists hold activity history in descending order with pagination', async () => {
    const holdEvents = [
      {
        holdId: 'hold-created',
        status: 'PENDING' as const,
        amountMinor: 1_000,
        createdAt: '2024-01-08T12:00:00.000Z',
        event: {
          at: '2024-01-08T12:00:00.000Z',
          type: 'CREATED' as const,
          createdByUserId: 'user-1',
          idempotencyKeyHash: 'hash-created',
        },
      },
      {
        holdId: 'hold-released',
        status: 'RELEASED' as const,
        amountMinor: 2_000,
        createdAt: '2024-01-07T12:00:00.000Z',
        releasedAt: '2024-01-07T14:00:00.000Z',
        releaseReason: 'Customer request',
        event: {
          at: '2024-01-07T14:00:00.000Z',
          type: 'RELEASED' as const,
          reason: 'Customer request',
        },
      },
      {
        holdId: 'hold-captured',
        status: 'CAPTURED' as const,
        amountMinor: 3_000,
        createdAt: '2024-01-06T12:00:00.000Z',
        relatedTransactionId: 'txn-captured',
        counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
        event: {
          at: '2024-01-06T13:00:00.000Z',
          type: 'CAPTURED' as const,
          transactionId: 'txn-captured',
          counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
        },
      },
      {
        holdId: 'hold-failed',
        status: 'FAILED' as const,
        amountMinor: 4_000,
        createdAt: '2024-01-05T12:00:00.000Z',
        event: {
          at: '2024-01-05T12:30:00.000Z',
          type: 'FAILED' as const,
          code: 'INTERNAL' as const,
          message: 'validation failure',
        },
      },
    ];

    for (const hold of holdEvents) {
      await repository.putHoldMeta({
        holdId: hold.holdId,
        payerAccountNumber: ACCOUNT_NUMBER,
        counterpartyAccountNumber: hold.counterpartyAccountNumber,
        amountMinor: hold.amountMinor,
        currency: 'USD',
        status: hold.status,
        description: `Hold ${hold.holdId}`,
        createdAt: hold.createdAt,
        releasedAt: hold.releasedAt,
        releaseReason: hold.releaseReason,
        relatedTransactionId: hold.relatedTransactionId,
      });
      await repository.appendHoldEvent(hold.holdId, hold.event);
    }

    const firstPage = await repository.listHoldActivityByAccountNumber(
      ACCOUNT_NUMBER,
      { limit: 2 }
    );

    expect(firstPage.items.map(item => item.event.type)).toEqual([
      'CREATED',
      'RELEASED',
    ]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextToken).toBeTruthy();

    const secondPage = await repository.listHoldActivityByAccountNumber(
      ACCOUNT_NUMBER,
      { limit: 2, nextToken: firstPage.nextToken }
    );

    expect(secondPage.items.map(item => item.event.type)).toEqual([
      'CAPTURED',
      'FAILED',
    ]);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextToken).toBeUndefined();

    const captured = secondPage.items.find(
      item => item.event.type === 'CAPTURED'
    );
    expect(captured).toBeDefined();
    expect(captured?.event).toMatchObject({
      transactionId: 'txn-captured',
      counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
    });
  });

  it('returns timeline events for a hold in chronological order', async () => {
    const holdId = 'hold-timeline';
    const createdAt = '2024-02-01T10:00:00.000Z';
    const capturedAt = '2024-02-01T11:00:00.000Z';
    const releasedAt = '2024-02-01T12:00:00.000Z';

    await repository.putHoldMeta({
      holdId,
      payerAccountNumber: ACCOUNT_NUMBER,
      counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
      amountMinor: 750,
      currency: 'USD',
      status: 'PENDING',
      description: 'Timeline verification hold',
      createdAt,
    });
    await repository.appendHoldEvent(holdId, {
      at: createdAt,
      type: 'CREATED',
      createdByUserId: USER_ID,
      idempotencyKeyHash: hashIdempotencyKey('timeline-created'),
    });

    await repository.putHoldMeta({
      holdId,
      payerAccountNumber: ACCOUNT_NUMBER,
      counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
      amountMinor: 750,
      currency: 'USD',
      status: 'CAPTURED',
      description: 'Timeline verification hold',
      createdAt,
      relatedTransactionId: 'txn-timeline',
    });
    await repository.appendHoldEvent(holdId, {
      at: capturedAt,
      type: 'CAPTURED',
      transactionId: 'txn-timeline',
      counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
    });

    await repository.putHoldMeta({
      holdId,
      payerAccountNumber: ACCOUNT_NUMBER,
      counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
      amountMinor: 750,
      currency: 'USD',
      status: 'RELEASED',
      description: 'Timeline verification hold',
      createdAt,
      releasedAt,
      releaseReason: 'Completed',
    });
    await repository.appendHoldEvent(holdId, {
      at: releasedAt,
      type: 'RELEASED',
      reason: 'Completed',
    });

    const events = await repository.listHoldEvents(holdId);

    expect(events.map(event => event.type)).toEqual([
      'CREATED',
      'CAPTURED',
      'RELEASED',
    ]);
    expect(events[0]).toMatchObject({
      type: 'CREATED',
      createdByUserId: USER_ID,
    });
    expect(events[1]).toMatchObject({
      type: 'CAPTURED',
      transactionId: 'txn-timeline',
      counterpartyAccountNumber: COUNTERPARTY_ACCOUNT_NUMBER,
    });
    expect(events[2]).toMatchObject({
      type: 'RELEASED',
      reason: 'Completed',
    });
  });
});
