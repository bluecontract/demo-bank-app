import { signUp, type SignUpResult } from '@demo-blue/auth';
import {
  DynamoUserRepository,
  AwsJwtService,
  PowertoolsLogger,
  PowertoolsMetrics,
  EnvironmentConfiguration,
  type LogLevel,
} from '@demo-blue/auth';
import { bankApiContract } from '@demo-blue/shared-bank-api-contract';
import { AppRouteImplementation } from '@ts-rest/serverless/aws';

const COOKIE_CONFIG = {
  NAME: 'demoAuth',
  ATTRIBUTES: 'HttpOnly; Secure; SameSite=None; Path=/',
} as const;

const createAuthCookie = (token: string, ttlSeconds: number): string => {
  return `${COOKIE_CONFIG.NAME}=${token}; Max-Age=${ttlSeconds}; ${COOKIE_CONFIG.ATTRIBUTES}`;
};

const getTtlSeconds = (
  user: SignUpResult['user'],
  config: { jwtTtlSeconds: number; testUserTtlSeconds: number }
): number => {
  return user.isTest ? config.testUserTtlSeconds : config.jwtTtlSeconds;
};

const formatResponse = (
  user: SignUpResult['user'],
  token: string,
  config: { jwtTtlSeconds: number; testUserTtlSeconds: number },
  responseHeaders: Headers
) => {
  const ttlSeconds = getTtlSeconds(user, config);
  responseHeaders.set('Set-Cookie', createAuthCookie(token, ttlSeconds));
  responseHeaders.set('Access-Control-Allow-Credentials', 'true');
  return {
    status: 201 as const,
    body: {
      userId: user.id,
      name: user.name,
    },
  };
};

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
  const awsEndpoint = process.env.AWS_ENDPOINT_URL; // For LocalStack testing

  const userRepository = new DynamoUserRepository({
    tableName: authConfig.dynamoTableName,
    region: awsRegion,
    testUserTtlSeconds: authConfig.testUserTtlSeconds,
    ...(awsEndpoint && { endpoint: awsEndpoint }),
  });

  const jwtService = new AwsJwtService({
    region: awsRegion,
    jwtSecretParameterName: authConfig.jwtSecretParameterName,
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

export const signUpHandler: AppRouteImplementation<
  typeof bankApiContract
>['signUp'] = async ({ body, query }, { responseHeaders }) => {
  const deps = await initializeDependencies();
  const { logger, config } = deps;

  try {
    const result = await signUp(
      {
        name: body.name,
        isTest: query?.dev === 'true',
      },
      deps
    );
    return formatResponse(result.user, result.token, config, responseHeaders);
  } catch (error: unknown) {
    logger.error('Sign-up failed', { error: String(error) });
    throw error;
  }
};
