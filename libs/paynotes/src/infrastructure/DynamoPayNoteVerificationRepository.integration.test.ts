import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  DynamoPayNoteVerificationRepository,
  type SavePayNoteVerificationInput,
} from './DynamoPayNoteVerificationRepository';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';

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
  tableName: `demo-bank-app-paynote-verification-${Date.now()}`,
  region: 'us-east-1',
  localstackEndpoint: resolveLocalstackEndpoint(),
};

let dynamoClient: DynamoDBClient;
let repository: DynamoPayNoteVerificationRepository;
let previousAwsProfile: string | undefined;
let previousAccessKeyId: string | undefined;
let previousSecretAccessKey: string | undefined;
let previousRegion: string | undefined;
let previousEndpoint: string | undefined;

const verificationInput: SavePayNoteVerificationInput = {
  userId: 'user-123',
  blueId: 'blue-abc',
  validationScore: 8,
  explanation: 'Looks good',
  isSuccessful: true,
  validatedAt: '2024-01-01T00:00:00.000Z',
  ttl: Math.floor(Date.now() / 1000) + 3600,
};

async function waitForTableReady() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const describe = await dynamoClient.send(
      new DescribeTableCommand({ TableName: TEST_CONFIG.tableName })
    );
    if (describe.Table?.TableStatus === 'ACTIVE') {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('DynamoDB table failed to become active');
}

describe('DynamoPayNoteVerificationRepository integration', () => {
  beforeAll(async () => {
    previousAwsProfile = process.env.AWS_PROFILE;
    previousAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    previousSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    previousRegion = process.env.AWS_REGION;
    previousEndpoint = process.env.AWS_ENDPOINT_URL;

    delete process.env.AWS_PROFILE;
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    process.env.AWS_REGION = TEST_CONFIG.region;
    process.env.AWS_ENDPOINT_URL = TEST_CONFIG.localstackEndpoint;

    dynamoClient = new DynamoDBClient({
      region: TEST_CONFIG.region,
      endpoint: TEST_CONFIG.localstackEndpoint,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    await dynamoClient.send(
      new CreateTableCommand({
        TableName: TEST_CONFIG.tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
      })
    );

    await waitForTableReady();

    repository = new DynamoPayNoteVerificationRepository({
      tableName: TEST_CONFIG.tableName,
      region: TEST_CONFIG.region,
      endpoint: TEST_CONFIG.localstackEndpoint,
    });
  });

  afterAll(async () => {
    await dynamoClient.send(
      new DeleteTableCommand({ TableName: TEST_CONFIG.tableName })
    );

    if (previousAwsProfile === undefined) {
      delete process.env.AWS_PROFILE;
    } else {
      process.env.AWS_PROFILE = previousAwsProfile;
    }

    if (previousAccessKeyId === undefined) {
      delete process.env.AWS_ACCESS_KEY_ID;
    } else {
      process.env.AWS_ACCESS_KEY_ID = previousAccessKeyId;
    }

    if (previousSecretAccessKey === undefined) {
      delete process.env.AWS_SECRET_ACCESS_KEY;
    } else {
      process.env.AWS_SECRET_ACCESS_KEY = previousSecretAccessKey;
    }

    if (previousRegion === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = previousRegion;
    }

    if (previousEndpoint === undefined) {
      delete process.env.AWS_ENDPOINT_URL;
    } else {
      process.env.AWS_ENDPOINT_URL = previousEndpoint;
    }
  });

  it('saves and retrieves verification records', async () => {
    await repository.saveVerification(verificationInput);

    const stored = await repository.getVerification({
      userId: verificationInput.userId,
      blueId: verificationInput.blueId,
    });

    expect(stored).toEqual(verificationInput);
  });

  it('returns null for non-existent verification', async () => {
    const result = await repository.getVerification({
      userId: 'user-999',
      blueId: 'missing',
    });
    expect(result).toBeNull();
  });

  it('persists ttl attribute in DynamoDB', async () => {
    const input: SavePayNoteVerificationInput = {
      ...verificationInput,
      blueId: 'blue-with-ttl',
      ttl: Math.floor(Date.now() / 1000) + 7200,
    };
    await repository.saveVerification(input);

    const item = await dynamoClient.send(
      new GetItemCommand({
        TableName: TEST_CONFIG.tableName,
        Key: {
          PK: { S: 'USER#user-123' },
          SK: { S: 'PAYNOTE_VERIFICATION#blue-with-ttl' },
        },
      })
    );

    expect(item.Item?.ttl?.N).toBe(String(input.ttl));
  });
});
