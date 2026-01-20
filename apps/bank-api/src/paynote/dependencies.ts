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
  createOpenAiValidationProvider,
  DynamoPayNoteVerificationRepository,
  DynamoPayNoteDeliveryRepository,
  DynamoPayNoteRepository,
  DynamoPayNoteBootstrapRepository,
  type PayNoteVerificationRepository,
  type PayNoteDeliveryRepository,
  type PayNoteRepository,
  type PayNoteBootstrapRepository,
  type BankingFacade,
  type MyOsClient,
  type BlueIdCalculator,
  type ClockPort,
  type IdGeneratorPort,
  type PayNoteValidationProvider,
} from '@demo-bank-app/paynotes';

export type PaynoteDependencies = {
  logger: PowertoolsLogger;
  getOpenAiApiKey: () => Promise<string>;
  getMyOsCredentials: () => Promise<MyOsCredentials>;
  payNoteVerificationRepository: PayNoteVerificationRepository;
  payNoteDeliveryRepository: PayNoteDeliveryRepository;
  payNoteRepository: PayNoteRepository;
  payNoteBootstrapRepository: PayNoteBootstrapRepository;
  bankingRepository: BankingRepository;
  holdRepository: HoldRepository;
  myOsClient: MyOsClient;
  bankingFacade: BankingFacade;
  blueIdCalculator: BlueIdCalculator;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  getOpenAiValidationProvider: () => Promise<PayNoteValidationProvider>;
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

  const payNoteDeliveryRepository = new DynamoPayNoteDeliveryRepository({
    tableName,
    region: awsRegion,
    endpoint: awsEndpoint,
  });

  const payNoteRepository = new DynamoPayNoteRepository({
    tableName,
    region: awsRegion,
    endpoint: awsEndpoint,
  });

  const payNoteBootstrapRepository = new DynamoPayNoteBootstrapRepository({
    tableName,
    region: awsRegion,
    endpoint: awsEndpoint,
  });

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

  let cachedValidationProvider: PayNoteValidationProvider | null = null;
  let cachedValidationApiKey: string | null = null;

  const getOpenAiValidationProvider = async () => {
    const apiKey = await getOpenAiApiKey();
    if (cachedValidationProvider && cachedValidationApiKey === apiKey) {
      return cachedValidationProvider;
    }

    cachedValidationProvider = createOpenAiValidationProvider({ apiKey });
    cachedValidationApiKey = apiKey;
    return cachedValidationProvider;
  };

  return {
    logger,
    getOpenAiApiKey,
    getMyOsCredentials,
    payNoteVerificationRepository,
    payNoteDeliveryRepository,
    payNoteRepository,
    payNoteBootstrapRepository,
    bankingRepository,
    holdRepository,
    myOsClient,
    bankingFacade,
    blueIdCalculator,
    clock,
    idGenerator,
    getOpenAiValidationProvider,
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
