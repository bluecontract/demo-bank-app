import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { AwsResilienceConfigBuilder } from '@demo-blue/shared-config';
import type { PowertoolsLogger } from '@demo-blue/shared-observability';
import { getLogger } from '../shared/logger';
import { createOpenAiApiKeyResolver } from '../shared/openAiSecrets';
import {
  createMyOsCredentialsResolver,
  type MyOsCredentials,
} from '../shared/myOsSecrets';
import {
  DynamoPayNoteVerificationRepository,
  DynamoBankingRepository,
  BankingEnvironmentConfiguration,
  type PayNoteVerificationRepository,
  type BankingRepository,
} from '@demo-blue/banking';

type PaynoteDependencies = {
  logger: PowertoolsLogger;
  getOpenAiApiKey: () => Promise<string>;
  getMyOsCredentials: () => Promise<MyOsCredentials>;
  payNoteVerificationRepository: PayNoteVerificationRepository;
  bankingRepository: BankingRepository;
};

let cachedDependencies: PaynoteDependencies | null = null;

const initializeDependencies = (): PaynoteDependencies => {
  const logger = getLogger();
  const awsRegion = process.env.AWS_REGION || 'eu-central-1';
  const awsEndpoint = process.env.AWS_ENDPOINT_URL;
  const openAiSecretArn = process.env.OPENAI_API_KEY_SECRET_ARN?.trim();
  const myOsSecretArn = process.env.MYOS_SECRET_ARN?.trim();
  const bankingConfig = new BankingEnvironmentConfiguration();

  const payNoteTableName =
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

  if (!payNoteTableName) {
    throw new Error(
      'BANKING_DYNAMO_TABLE_NAME environment variable is required for PayNote verification storage.'
    );
  }

  const payNoteVerificationRepository = new DynamoPayNoteVerificationRepository(
    {
      tableName: payNoteTableName,
      region: awsRegion,
      endpoint: awsEndpoint,
    }
  );

  const bankingRepository = new DynamoBankingRepository({
    tableName: payNoteTableName,
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });

  return {
    logger,
    getOpenAiApiKey,
    getMyOsCredentials,
    payNoteVerificationRepository,
    bankingRepository,
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
