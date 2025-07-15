import {
  DynamoBankingRepository,
  SimpleAccountNumberGenerator,
  BankingEnvironmentConfiguration,
} from '@demo-blue/banking';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-blue/shared-observability';
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

  const awsRegion = process.env.AWS_REGION || 'eu-central-1';
  const awsEndpoint = process.env.AWS_ENDPOINT_URL;

  const repository = new DynamoBankingRepository({
    tableName: envConfig.dynamoTableName,
    region: awsRegion,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });

  const accountNumberGenerator = new SimpleAccountNumberGenerator();

  return {
    repository,
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
