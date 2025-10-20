import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthEnvironmentConfiguration } from './AuthConfiguration';
import { ConfigurationValidationError } from '@demo-bank-app/shared-config';

describe('AuthEnvironmentConfiguration', () => {
  let config: AuthEnvironmentConfiguration;
  const originalEnv = process.env;

  beforeEach(() => {
    config = new AuthEnvironmentConfiguration();
    process.env = { ...originalEnv };
    // Reset NODE_ENV to avoid test environment interference
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getAuthConfig', () => {
    it('should return auth configuration when all required variables are set', async () => {
      process.env.AUTH_DYNAMO_TABLE_NAME = 'auth-table';
      process.env.JWT_SECRET_ARN =
        'arn:aws:secretsmanager:region:account:secret:jwt-secret';
      process.env.JWT_TTL_SECONDS = '7200';
      process.env.TEST_USER_TTL_SECONDS = '172800';
      process.env.NODE_ENV = 'production';
      process.env.SERVICE_NAME = 'my-auth-service';
      process.env.LOG_LEVEL = 'WARN';
      process.env.METRICS_NAMESPACE = 'MyApp/Auth';

      const authConfig = await config.getAuthConfig();

      expect(authConfig).toEqual({
        dynamoTableName: 'auth-table',
        jwtSecretArn: 'arn:aws:secretsmanager:region:account:secret:jwt-secret',
        jwtTtlSeconds: 7200,
        testUserTtlSeconds: 172800,
        environment: 'production',
        serviceName: 'my-auth-service',
        logLevel: 'WARN',
        metricsNamespace: 'MyApp/Auth',
      });
    });

    it('should return auth configuration with defaults when optional variables are not set', async () => {
      process.env.AUTH_DYNAMO_TABLE_NAME = 'auth-table';
      process.env.JWT_SECRET_ARN =
        'arn:aws:secretsmanager:region:account:secret:jwt-secret';

      const authConfig = await config.getAuthConfig();

      expect(authConfig).toEqual({
        dynamoTableName: 'auth-table',
        jwtSecretArn: 'arn:aws:secretsmanager:region:account:secret:jwt-secret',
        jwtTtlSeconds: 3600,
        testUserTtlSeconds: 86400,
        environment: 'development',
        serviceName: 'auth',
        logLevel: 'INFO',
        metricsNamespace: 'App/Auth',
      });
    });

    it('should throw ConfigurationValidationError when AUTH_DYNAMO_TABLE_NAME is missing', async () => {
      process.env.JWT_SECRET_ARN =
        'arn:aws:secretsmanager:region:account:secret:jwt-secret';

      await expect(config.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
    });

    it('should throw ConfigurationValidationError when JWT_SECRET_ARN is missing', async () => {
      process.env.AUTH_DYNAMO_TABLE_NAME = 'auth-table';

      await expect(config.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
    });

    it('should throw ConfigurationValidationError when JWT_TTL_SECONDS is out of range', async () => {
      process.env.AUTH_DYNAMO_TABLE_NAME = 'auth-table';
      process.env.JWT_SECRET_ARN =
        'arn:aws:secretsmanager:region:account:secret:jwt-secret';
      process.env.JWT_TTL_SECONDS = '86401'; // More than 24 hours

      await expect(config.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
    });

    it('should throw ConfigurationValidationError when JWT_TTL_SECONDS is too low', async () => {
      process.env.AUTH_DYNAMO_TABLE_NAME = 'auth-table';
      process.env.JWT_SECRET_ARN =
        'arn:aws:secretsmanager:region:account:secret:jwt-secret';
      process.env.JWT_TTL_SECONDS = '0';

      await expect(config.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
    });

    it('should throw ConfigurationValidationError when TEST_USER_TTL_SECONDS is out of range', async () => {
      process.env.AUTH_DYNAMO_TABLE_NAME = 'auth-table';
      process.env.JWT_SECRET_ARN =
        'arn:aws:secretsmanager:region:account:secret:jwt-secret';
      process.env.TEST_USER_TTL_SECONDS = '604801'; // More than 7 days

      await expect(config.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
    });

    it('should throw ConfigurationValidationError when TEST_USER_TTL_SECONDS is too low', async () => {
      process.env.AUTH_DYNAMO_TABLE_NAME = 'auth-table';
      process.env.JWT_SECRET_ARN =
        'arn:aws:secretsmanager:region:account:secret:jwt-secret';
      process.env.TEST_USER_TTL_SECONDS = '0';

      await expect(config.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
    });

    it('should throw ConfigurationValidationError when LOG_LEVEL is invalid', async () => {
      process.env.AUTH_DYNAMO_TABLE_NAME = 'auth-table';
      process.env.JWT_SECRET_ARN =
        'arn:aws:secretsmanager:region:account:secret:jwt-secret';
      process.env.LOG_LEVEL = 'INVALID_LEVEL';

      await expect(config.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
    });

    it('should include all missing variables in error message', async () => {
      try {
        await config.getAuthConfig();
        expect.fail('Should have thrown ConfigurationValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationValidationError);
        const configError = error as ConfigurationValidationError;
        expect(configError.missingVariables).toEqual([
          'AUTH_DYNAMO_TABLE_NAME',
          'JWT_SECRET_ARN',
        ]);
        expect(configError.message).toContain(
          'Missing required environment variables'
        );
      }
    });
  });

  describe('isTestMode', () => {
    it('should return true when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test';
      expect(config.isTestMode()).toBe(true);
    });

    it('should return true when NODE_ENV is testing', () => {
      process.env.NODE_ENV = 'testing';
      expect(config.isTestMode()).toBe(true);
    });

    it('should return false when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      expect(config.isTestMode()).toBe(false);
    });

    it('should return false when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';
      expect(config.isTestMode()).toBe(false);
    });
  });

  describe('getEnvironment', () => {
    it('should return environment from NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      expect(config.getEnvironment()).toBe('production');
    });

    it('should return default environment when NODE_ENV is not set', () => {
      expect(config.getEnvironment()).toBe('development');
    });
  });
});
