import {
  DynamoBankingRepository,
  DynamoHoldRepository,
  SimpleAccountNumberGenerator,
  BankingEnvironmentConfiguration,
} from '@demo-bank-app/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import { getLogger } from '../shared/logger';
import { getMetrics } from '../shared/metrics';

let globalDependencies: Awaited<
  ReturnType<typeof initializeDependencies>
> | null = null;

const initializeDependencies = async (
  logger: PowertoolsLogger,
  metrics: PowertoolsMetrics
) => {
  const envConfig = new BankingEnvironmentConfiguration();

  const awsRegion = process.env.AWS_REGION || 'eu-west-1';
  const awsEndpoint = process.env.AWS_ENDPOINT_URL;

  const repository = new DynamoBankingRepository({
    tableName: envConfig.dynamoTableName,
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });

  const accountNumberGenerator = new SimpleAccountNumberGenerator();
  const holdRepository = new DynamoHoldRepository({
    tableName: envConfig.dynamoTableName,
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
    logger,
    metrics,
  });

  return {
    repository,
    holdRepository,
    accountNumberGenerator,
    logger,
    metrics,
    config: {},
  };
};

export const getDependencies = async () => {
  if (!globalDependencies) {
    globalDependencies = await initializeDependencies(
      getLogger(),
      getMetrics()
    );
  }
  return globalDependencies;
};

export const resetDependencies = () => {
  globalDependencies = null;
};
