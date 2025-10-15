import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { AwsResilienceConfigBuilder } from '@demo-blue/shared-config';
import type { PowertoolsLogger } from '@demo-blue/shared-observability';
import { getLogger } from '../shared/logger';
import { createOpenAiApiKeyResolver } from '../shared/openAiSecrets';

type PaynoteDependencies = {
  logger: PowertoolsLogger;
  getOpenAiApiKey: () => Promise<string>;
};

let cachedDependencies: PaynoteDependencies | null = null;

const initializeDependencies = (): PaynoteDependencies => {
  const logger = getLogger();
  const awsRegion = process.env.AWS_REGION || 'eu-central-1';
  const awsEndpoint = process.env.AWS_ENDPOINT_URL;
  const openAiSecretArn = process.env.OPENAI_API_KEY_SECRET_ARN?.trim();

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

  return {
    logger,
    getOpenAiApiKey,
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
