import { randomUUID } from 'node:crypto';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  ResourceExistsException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { CARD_SETTLEMENT } from '@demo-bank-app/banking';
import {
  DynamoContractRepository,
  type ContractRecord,
} from '@demo-bank-app/contracts';
import {
  DynamoBootstrapContextRepository,
  DynamoPayNoteRepository,
  DynamoPayNoteDeliveryRepository,
  type PayNoteDeliveryRecord,
  type PayNoteRecord,
} from '@demo-bank-app/paynotes';
import { BankTestDriver } from './BankTestDriver';
import { MyOsHarness } from './MyOsHarness';
import { resetBankRuntimeDependencies } from './invokeBankApi';
import { waitForExpectWithLogging } from './wait';

type AwsClients = {
  dynamoClient: DynamoDBClient;
  secretsManagerClient: SecretsManagerClient;
};

export type PayNoteLiveTestContext = {
  bank: BankTestDriver;
  myOs: MyOsHarness;
  tableName: string;
  resourceId: string;
  saveBootstrapContext: (input: {
    bootstrapSessionId: string;
    accountNumber: string;
    userId: string;
    merchantId?: string;
    createdAt?: string;
  }) => Promise<void>;
  getRawDeliveryBySessionId: (
    sessionId: string
  ) => Promise<PayNoteDeliveryRecord | null>;
  waitForRawDeliveryBySessionId: (
    sessionId: string,
    timeoutMs?: number
  ) => Promise<any>;
  getRawContractBySessionId: (
    sessionId: string
  ) => Promise<ContractRecord | null>;
  getRawPayNoteBySessionId: (
    sessionId: string
  ) => Promise<PayNoteRecord | null>;
  cleanup: () => Promise<void>;
};

export type PayNoteLiveTestContextOptions = {
  myOsCredentials?: {
    apiKey: string;
    accountId: string;
    baseUrl: string;
  };
};

const TRACKED_ENV_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_ENDPOINT_URL',
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_SDK_LOAD_CONFIG',
  'AUTH_DYNAMO_TABLE_NAME',
  'BANKING_DYNAMO_TABLE_NAME',
  'JWT_SECRET_ARN',
  'JWT_TTL_SECONDS',
  'TEST_USER_TTL_SECONDS',
  'MYOS_SECRET_ARN',
  'OPENAI_API_KEY_SECRET_ARN',
  'DEFAULT_MERCHANT_CREDIT_LIMIT_MINOR',
  'SERVICE_NAME',
  'LOG_LEVEL',
  'METRICS_NAMESPACE',
  'CARD_PAN_SECRET',
  'CARD_CVC_SECRET',
  'CARD_PROCESSOR_TOKEN',
  'CARD_BIN_PREFIX',
  'CARD_SETTLEMENT_ACCOUNT_ID',
  'CARD_SETTLEMENT_ACCOUNT_NUMBER',
];

const DEFAULT_JWT_SECRET = 'paynotes-integration-jwt-secret';
const DEFAULT_MERCHANT_CREDIT_LIMIT_MINOR = '500000';

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

const captureEnvSnapshot = () =>
  new Map(TRACKED_ENV_KEYS.map(key => [key, process.env[key]]));

const restoreEnvSnapshot = (snapshot: Map<string, string | undefined>) => {
  TRACKED_ENV_KEYS.forEach(key => {
    const previousValue = snapshot.get(key);
    if (previousValue === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = previousValue;
  });
};

const createAwsClients = (): AwsClients => {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const endpoint = process.env.AWS_ENDPOINT_URL ?? resolveLocalstackEndpoint();
  const credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  };

  return {
    dynamoClient: new DynamoDBClient({
      region,
      endpoint,
      credentials,
    }),
    secretsManagerClient: new SecretsManagerClient({
      region,
      endpoint,
      credentials,
    }),
  };
};

const createSecret = async (
  client: SecretsManagerClient,
  name: string,
  payload: string
) => {
  try {
    await client.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: payload,
      })
    );
  } catch (error) {
    if (!(error instanceof ResourceExistsException)) {
      throw error;
    }
  }
};

const waitForTableActive = async (
  dynamoClient: DynamoDBClient,
  tableName: string
) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const result = await dynamoClient.send(
        new DescribeTableCommand({ TableName: tableName })
      );
      if (result.Table?.TableStatus === 'ACTIVE') {
        return;
      }
    } catch {
      // keep polling
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`DynamoDB table "${tableName}" failed to become ACTIVE`);
};

const seedBaseBankRows = async (
  dynamoClient: DynamoDBClient,
  tableName: string
) => {
  const fundingSourceCreatedAt = new Date().toISOString();

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        PK: { S: 'ACCOUNT#FUNDING_SOURCE' },
        SK: { S: 'META' },
        BANKING_GSI1PK: { S: 'USER#SYSTEM' },
        BANKING_GSI1SK: { S: fundingSourceCreatedAt },
        accountNumber: { S: '0000000000' },
        name: { S: 'System Funding Source' },
        ownerUserId: { S: 'SYSTEM' },
        status: { S: 'ACTIVE' },
        currency: { S: 'USD' },
        createdAt: { S: fundingSourceCreatedAt },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        PK: { S: 'ACCOUNT#FUNDING_SOURCE' },
        SK: { S: 'BALANCE' },
        ledgerBalanceMinor: { N: '0' },
        availableBalanceMinor: { N: '0' },
        version: { N: '0' },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        PK: { S: 'ACCOUNT_NUMBER#0000000000' },
        SK: { S: 'RESERVE' },
        accountId: { S: 'FUNDING_SOURCE' },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );

  const cardSettlementCreatedAt = new Date().toISOString();
  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        PK: { S: `ACCOUNT#${CARD_SETTLEMENT.ACCOUNT_ID}` },
        SK: { S: 'META' },
        BANKING_GSI1PK: { S: 'USER#SYSTEM' },
        BANKING_GSI1SK: { S: cardSettlementCreatedAt },
        accountNumber: { S: CARD_SETTLEMENT.ACCOUNT_NUMBER },
        name: { S: 'Card Settlement' },
        ownerUserId: { S: 'SYSTEM' },
        status: { S: 'ACTIVE' },
        currency: { S: 'USD' },
        createdAt: { S: cardSettlementCreatedAt },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        PK: { S: `ACCOUNT#${CARD_SETTLEMENT.ACCOUNT_ID}` },
        SK: { S: 'BALANCE' },
        ledgerBalanceMinor: { N: '0' },
        availableBalanceMinor: { N: '0' },
        version: { N: '0' },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        PK: { S: `ACCOUNT_NUMBER#${CARD_SETTLEMENT.ACCOUNT_NUMBER}` },
        SK: { S: 'RESERVE' },
        accountId: { S: CARD_SETTLEMENT.ACCOUNT_ID },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );
};

const createBankTable = async (
  dynamoClient: DynamoDBClient,
  tableName: string
) => {
  await dynamoClient.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'AUTH_GSI1PK', AttributeType: 'S' },
        { AttributeName: 'AUTH_GSI1SK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI1PK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI1SK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI2PK', AttributeType: 'S' },
        { AttributeName: 'BANKING_GSI2SK', AttributeType: 'S' },
        { AttributeName: 'HOLD_GSI1PK', AttributeType: 'S' },
        { AttributeName: 'HOLD_GSI1SK', AttributeType: 'S' },
        { AttributeName: 'HOLD_EVENT_GSI1PK', AttributeType: 'S' },
        { AttributeName: 'HOLD_EVENT_GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'AUTH_GSI1',
          KeySchema: [
            { AttributeName: 'AUTH_GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'AUTH_GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
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
          IndexName: 'HOLD_GSI1',
          KeySchema: [
            { AttributeName: 'HOLD_GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'HOLD_GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'HOLD_EVENT_GSI1',
          KeySchema: [
            { AttributeName: 'HOLD_EVENT_GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'HOLD_EVENT_GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    })
  );

  await waitForTableActive(dynamoClient, tableName);
  await seedBaseBankRows(dynamoClient, tableName);
};

const cleanupResources = async (
  clients: AwsClients,
  input: {
    tableName: string;
    jwtSecretArn: string;
    openAiSecretArn: string;
    myOsSecretArn: string;
  }
) => {
  await Promise.allSettled([
    clients.dynamoClient.send(
      new DeleteTableCommand({ TableName: input.tableName })
    ),
    clients.secretsManagerClient.send(
      new DeleteSecretCommand({
        SecretId: input.jwtSecretArn,
        ForceDeleteWithoutRecovery: true,
      })
    ),
    clients.secretsManagerClient.send(
      new DeleteSecretCommand({
        SecretId: input.openAiSecretArn,
        ForceDeleteWithoutRecovery: true,
      })
    ),
    clients.secretsManagerClient.send(
      new DeleteSecretCommand({
        SecretId: input.myOsSecretArn,
        ForceDeleteWithoutRecovery: true,
      })
    ),
  ]);
};

export const createPayNoteLiveTestContext = async (
  options: PayNoteLiveTestContextOptions = {}
): Promise<PayNoteLiveTestContext> => {
  const resourceId = `paynotes-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const tableName = `demo-bank-${resourceId}`;
  const jwtSecretArn = `/demo-bank-app/${resourceId}/auth-jwt-secret`;
  const myOsSecretArn = `/demo-bank-app/${resourceId}/myos-credentials`;
  const openAiSecretArn = `/demo-bank-app/${resourceId}/openai-api-key`;
  const previousEnv = captureEnvSnapshot();

  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
  delete process.env.AWS_SESSION_TOKEN;
  process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
  process.env.AWS_ENDPOINT_URL = resolveLocalstackEndpoint();
  delete process.env.AWS_PROFILE;
  delete process.env.AWS_DEFAULT_PROFILE;
  delete process.env.AWS_CONFIG_FILE;
  delete process.env.AWS_SHARED_CREDENTIALS_FILE;
  delete process.env.AWS_SDK_LOAD_CONFIG;
  process.env.AUTH_DYNAMO_TABLE_NAME = tableName;
  process.env.BANKING_DYNAMO_TABLE_NAME = tableName;
  process.env.JWT_SECRET_ARN = jwtSecretArn;
  process.env.JWT_TTL_SECONDS = '604800';
  process.env.TEST_USER_TTL_SECONDS = '600';
  process.env.MYOS_SECRET_ARN = myOsSecretArn;
  process.env.OPENAI_API_KEY_SECRET_ARN = openAiSecretArn;
  process.env.DEFAULT_MERCHANT_CREDIT_LIMIT_MINOR =
    DEFAULT_MERCHANT_CREDIT_LIMIT_MINOR;
  process.env.SERVICE_NAME = 'bank-api-paynotes-integration-test';
  process.env.LOG_LEVEL = 'INFO';
  process.env.METRICS_NAMESPACE = 'PayNotesIntegration';
  process.env.CARD_PAN_SECRET = 'paynotes-integration-pan-secret';
  process.env.CARD_CVC_SECRET = 'paynotes-integration-cvc-secret';
  process.env.CARD_PROCESSOR_TOKEN =
    process.env.CARD_PROCESSOR_TOKEN ?? 'demo-bank-processor-token';
  process.env.CARD_BIN_PREFIX = '123456';
  process.env.CARD_SETTLEMENT_ACCOUNT_ID = CARD_SETTLEMENT.ACCOUNT_ID;
  process.env.CARD_SETTLEMENT_ACCOUNT_NUMBER = CARD_SETTLEMENT.ACCOUNT_NUMBER;

  resetBankRuntimeDependencies();

  const clients = createAwsClients();
  await createBankTable(clients.dynamoClient, tableName);
  await createSecret(
    clients.secretsManagerClient,
    jwtSecretArn,
    JSON.stringify({ secret: DEFAULT_JWT_SECRET })
  );
  await createSecret(
    clients.secretsManagerClient,
    openAiSecretArn,
    JSON.stringify({ openAiApiKey: 'dummy-not-used' })
  );

  const myOs = new MyOsHarness();
  await myOs.start();
  const myOsCredentials = options.myOsCredentials ?? {
    apiKey: myOs.apiKey,
    accountId: 'bank-account',
    baseUrl: myOs.baseUrl,
  };

  await createSecret(
    clients.secretsManagerClient,
    myOsSecretArn,
    JSON.stringify({
      apiKey: myOsCredentials.apiKey,
      accountId: myOsCredentials.accountId,
      baseUrl: myOsCredentials.baseUrl,
    })
  );

  const bank = new BankTestDriver();
  const bootstrapContextRepository = new DynamoBootstrapContextRepository({
    tableName,
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL,
  });
  const payNoteDeliveryRepository = new DynamoPayNoteDeliveryRepository({
    tableName,
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL,
  });
  const contractRepository = new DynamoContractRepository({
    tableName,
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL,
  });
  const payNoteRepository = new DynamoPayNoteRepository({
    tableName,
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL,
  });

  return {
    bank,
    myOs,
    tableName,
    resourceId,
    saveBootstrapContext: async input => {
      await bootstrapContextRepository.saveContext({
        bootstrapSessionId: input.bootstrapSessionId,
        accountNumber: input.accountNumber,
        userId: input.userId,
        ...(input.merchantId ? { merchantId: input.merchantId } : {}),
        createdAt: input.createdAt ?? new Date().toISOString(),
      });
    },
    getRawDeliveryBySessionId: async sessionId =>
      payNoteDeliveryRepository.getDeliveryBySessionId(sessionId),
    waitForRawDeliveryBySessionId: async (sessionId, timeoutMs = 10_000) => {
      let matched: any;
      await waitForExpectWithLogging(
        async () => {
          matched = await payNoteDeliveryRepository.getDeliveryBySessionId(
            sessionId
          );
          if (!matched) {
            throw new Error('Raw delivery not visible yet');
          }
        },
        timeoutMs,
        250,
        'raw-delivery-by-session'
      );
      return matched;
    },
    getRawContractBySessionId: async sessionId =>
      contractRepository.getContractBySessionId(sessionId),
    getRawPayNoteBySessionId: async sessionId =>
      payNoteRepository.getPayNoteBySessionId(sessionId),
    cleanup: async () => {
      await myOs.stop();
      resetBankRuntimeDependencies();
      await cleanupResources(clients, {
        tableName,
        jwtSecretArn,
        openAiSecretArn,
        myOsSecretArn,
      });
      restoreEnvSnapshot(previousEnv);
      resetBankRuntimeDependencies();
    },
  };
};
