import {
  DynamoUserRepository,
  AwsJwtService,
  PowertoolsLogger,
  PowertoolsMetrics,
  EnvironmentConfiguration,
  type LogLevel,
} from '@demo-blue/auth';

// Global dependencies - initialized once per Lambda container
let globalDependencies: Awaited<
  ReturnType<typeof initializeDependencies>
> | null = null;

const initializeDependencies = async () => {
  const envConfig = new EnvironmentConfiguration();
  const authConfig = await envConfig.getAuthConfig();

  const logger = new PowertoolsLogger({
    level: authConfig.logLevel as LogLevel,
    serviceName: authConfig.serviceName,
    environment: authConfig.environment,
  });

  const metrics = new PowertoolsMetrics({
    namespace: authConfig.metricsNamespace,
    serviceName: authConfig.serviceName,
    environment: authConfig.environment,
  });

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

  logger.info('Dependencies initialized', {
    environment: authConfig.environment,
    serviceName: authConfig.serviceName,
    metricsNamespace: authConfig.metricsNamespace,
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
    globalDependencies = await initializeDependencies();
  }
  return globalDependencies;
};

// Reset dependencies for testing
export const resetDependencies = () => {
  globalDependencies = null;
};
