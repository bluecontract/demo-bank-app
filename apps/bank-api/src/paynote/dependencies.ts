import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { AwsResilienceConfigBuilder } from '@demo-bank-app/shared-config';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';
import { getLogger } from '../shared/logger';
import { createOpenAiApiKeyResolver } from '../shared/openAiSecrets';
import {
  createMyOsCredentialsResolver,
  type MyOsCredentials,
} from '../shared/myOsSecrets';
import {
  DynamoBankingRepository,
  BankingEnvironmentConfiguration,
  type BankingRepository,
  DynamoHoldRepository,
  HoldRepository,
} from '@demo-bank-app/banking';
import {
  createBankingFacade,
  createHttpMyOsGateway,
  createBlueIdCalculator,
  createSystemClock,
  createRandomIdGenerator,
  DynamoPayNoteVerificationRepository,
  type PayNoteVerificationRepository,
  type BankingFacade,
  type MyOsClient,
  type BlueIdCalculator,
  type ClockPort,
  type IdGeneratorPort,
} from '@demo-bank-app/paynotes';

export type PaynoteDependencies = {
  logger: PowertoolsLogger;
  getOpenAiApiKey: () => Promise<string>;
  getMyOsCredentials: () => Promise<MyOsCredentials>;
  payNoteVerificationRepository: PayNoteVerificationRepository;
  bankingRepository: BankingRepository;
  holdRepository: HoldRepository;
  myOsClient: MyOsClient;
  bankingFacade: BankingFacade;
  blueIdCalculator: BlueIdCalculator;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
};

let cachedDependencies: PaynoteDependencies | null = null;

const initializeDependencies = (): PaynoteDependencies => {
  const logger = getLogger();
  const awsRegion = process.env.AWS_REGION || 'eu-west-1';
  const awsEndpoint = process.env.AWS_ENDPOINT_URL;
  const openAiSecretArn = process.env.OPENAI_API_KEY_SECRET_ARN?.trim();
  const myOsSecretArn = process.env.MYOS_SECRET_ARN?.trim();
  const bankingConfig = new BankingEnvironmentConfiguration();

  const tableName =
    process.env.BANKING_DYNAMO_TABLE_NAME?.trim() ||
    process.env.AUTH_DYNAMO_TABLE_NAME?.trim() ||
    bankingConfig.dynamoTableName;

  const secretsResilienceConfig =
    AwsResilienceConfigBuilder.forSecretsManager();
  const secretsClient = new SecretsManagerClient({
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
    ...AwsResilienceConfigBuilder.toAwsConfig(secretsResilienceConfig),
  });

  const getOpenAiApiKey = createOpenAiApiKeyResolver({
    secretArn: openAiSecretArn,
    secretsClient,
  });

  const getMyOsCredentials = createMyOsCredentialsResolver({
    secretArn: myOsSecretArn,
    secretsClient,
  });

  if (!tableName) {
    throw new Error(
      'BANKING_DYNAMO_TABLE_NAME environment variable is required for PayNote verification storage.'
    );
  }

  const payNoteVerificationRepository = new DynamoPayNoteVerificationRepository(
    {
      tableName,
      region: awsRegion,
      endpoint: awsEndpoint,
    }
  );

  const bankingRepository = new DynamoBankingRepository({
    tableName,
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });

  const holdRepository = new DynamoHoldRepository({
    tableName,
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });

  const myOsClient = createHttpMyOsGateway(getMyOsCredentials);

  const bankingFacade = createBankingFacade({
    bankingRepository,
    holdRepository,
    logger,
  });

  const blueIdCalculator = createBlueIdCalculator();
  const clock = createSystemClock();
  const idGenerator = createRandomIdGenerator();

  return {
    logger,
    getOpenAiApiKey,
    getMyOsCredentials,
    payNoteVerificationRepository,
    bankingRepository,
    holdRepository,
    myOsClient,
    bankingFacade,
    blueIdCalculator,
    clock,
    idGenerator,
  };
};

export const getDependencies = async (): Promise<PaynoteDependencies> => {
  if (!cachedDependencies) {
    cachedDependencies = initializeDependencies();
  }

  return cachedDependencies;
};

export const resetDependencies = () => {
  cachedDependencies = null;
};
