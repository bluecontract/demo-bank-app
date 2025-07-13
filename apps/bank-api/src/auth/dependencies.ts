import {
  DynamoUserRepository,
  AwsJwtService,
  EnvironmentConfiguration,
} from '@demo-blue/auth';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-blue/shared-observability';
import { getLogger } from '../shared/logger';
import { getMetrics } from '../shared/metrics';

// Global dependencies - initialized once per Lambda container
let globalDependencies: Awaited<
  ReturnType<typeof initializeDependencies>
> | null = null;

const initializeDependencies = async (
  logger: PowertoolsLogger,
  metrics: PowertoolsMetrics
) => {
  const envConfig = new EnvironmentConfiguration();
  const authConfig = await envConfig.getAuthConfig();

  const awsRegion = process.env.AWS_REGION || 'eu-central-1';
  const awsEndpoint = process.env.AWS_ENDPOINT_URL;

  const userRepository = new DynamoUserRepository({
    tableName: authConfig.dynamoTableName,
    region: awsRegion,
    testUserTtlSeconds: authConfig.testUserTtlSeconds,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });

  const jwtService = new AwsJwtService({
    region: awsRegion,
    jwtSecretArn: authConfig.jwtSecretArn,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });

  return {
    userRepository,
    jwtService,
    logger,
    metrics,
    config: {
      jwtTtlSeconds: authConfig.jwtTtlSeconds,
      testUserTtlSeconds: authConfig.testUserTtlSeconds,
    },
  };
};

// Get or initialize global dependencies
export const getDependencies = async () => {
  if (!globalDependencies) {
    globalDependencies = await initializeDependencies(
      getLogger(),
      getMetrics()
    );
  }
  return globalDependencies;
};

// Reset dependencies for testing
export const resetDependencies = () => {
  globalDependencies = null;
};
