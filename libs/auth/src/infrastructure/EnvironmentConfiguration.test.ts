import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EnvironmentConfiguration,
  ConfigurationValidationError,
} from './EnvironmentConfiguration';

describe('EnvironmentConfiguration', () => {
  let envConfig: EnvironmentConfiguration;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    envConfig = new EnvironmentConfiguration();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('getAuthConfig', () => {
    it('should return valid configuration when all required variables are set', async () => {
      process.env.DYNAMO_TABLE_NAME = 'test-table';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';
      process.env.JWT_TTL_SECONDS = '1800';
      process.env.TEST_USER_TTL_SECONDS = '3600';
      process.env.SERVICE_NAME = 'test-service';
      process.env.LOG_LEVEL = 'DEBUG';
      process.env.METRICS_NAMESPACE = 'Test/Auth';
      process.env.NODE_ENV = 'development';

      const config = await envConfig.getAuthConfig();

      expect(config).toEqual({
        dynamoTableName: 'test-table',
        jwtSecretParameterName: '/test/jwt-secret',
        jwtTtlSeconds: 1800,
        testUserTtlSeconds: 3600,
        environment: 'development',
        serviceName: 'test-service',
        logLevel: 'DEBUG',
        metricsNamespace: 'Test/Auth',
      });
    });

    it('should use defaults for optional variables when required variables are set', async () => {
      process.env.DYNAMO_TABLE_NAME = 'test-table';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';

      const config = await envConfig.getAuthConfig();

      expect(config.jwtTtlSeconds).toBe(3600);
      expect(config.testUserTtlSeconds).toBe(86400);
      expect(config.serviceName).toBe('auth');
      expect(config.logLevel).toBe('INFO');
      expect(config.metricsNamespace).toBe('App/Auth');
    });

    it('should throw ConfigurationValidationError when DYNAMO_TABLE_NAME is missing', async () => {
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';

      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        'DYNAMO_TABLE_NAME'
      );
    });

    it('should throw ConfigurationValidationError when JWT_SECRET_PARAMETER_NAME is missing', async () => {
      process.env.DYNAMO_TABLE_NAME = 'test-table';

      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        'JWT_SECRET_PARAMETER_NAME'
      );
    });

    it('should throw ConfigurationValidationError when multiple required variables are missing', async () => {
      const error = await envConfig.getAuthConfig().catch(e => e);

      expect(error).toBeInstanceOf(ConfigurationValidationError);
      expect(error.message).toContain('DYNAMO_TABLE_NAME');
      expect(error.message).toContain('JWT_SECRET_PARAMETER_NAME');
      expect(error.missingVariables).toEqual([
        'DYNAMO_TABLE_NAME',
        'JWT_SECRET_PARAMETER_NAME',
      ]);
    });

    it('should throw ConfigurationValidationError when required variable is empty string', async () => {
      process.env.DYNAMO_TABLE_NAME = '';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';

      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        'DYNAMO_TABLE_NAME'
      );
    });

    it('should throw ConfigurationValidationError when required variable is only whitespace', async () => {
      process.env.DYNAMO_TABLE_NAME = '   ';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';

      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        'DYNAMO_TABLE_NAME'
      );
    });

    it('should throw ConfigurationValidationError when JWT_TTL_SECONDS is invalid', async () => {
      process.env.DYNAMO_TABLE_NAME = 'test-table';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';
      process.env.JWT_TTL_SECONDS = '0';

      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        'JWT_TTL_SECONDS must be between 1 and 86400'
      );
    });

    it('should throw ConfigurationValidationError when JWT_TTL_SECONDS exceeds maximum', async () => {
      process.env.DYNAMO_TABLE_NAME = 'test-table';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';
      process.env.JWT_TTL_SECONDS = '86401';

      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        'JWT_TTL_SECONDS must be between 1 and 86400'
      );
    });

    it('should throw ConfigurationValidationError when TEST_USER_TTL_SECONDS is invalid', async () => {
      process.env.DYNAMO_TABLE_NAME = 'test-table';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';
      process.env.TEST_USER_TTL_SECONDS = '604801';

      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        'TEST_USER_TTL_SECONDS must be between 1 and 604800'
      );
    });

    it('should throw ConfigurationValidationError when LOG_LEVEL is invalid', async () => {
      process.env.DYNAMO_TABLE_NAME = 'test-table';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';
      process.env.LOG_LEVEL = 'INVALID';

      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        ConfigurationValidationError
      );
      await expect(envConfig.getAuthConfig()).rejects.toThrow(
        'LOG_LEVEL must be one of: DEBUG, INFO, WARN, ERROR'
      );
    });

    it('should trim whitespace from string values', async () => {
      process.env.DYNAMO_TABLE_NAME = '  test-table  ';
      process.env.JWT_SECRET_PARAMETER_NAME = '  /test/jwt-secret  ';
      process.env.SERVICE_NAME = '  test-service  ';

      const config = await envConfig.getAuthConfig();

      expect(config.dynamoTableName).toBe('test-table');
      expect(config.jwtSecretParameterName).toBe('/test/jwt-secret');
      expect(config.serviceName).toBe('test-service');
    });

    it('should handle case-insensitive log levels', async () => {
      process.env.DYNAMO_TABLE_NAME = 'test-table';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';
      process.env.LOG_LEVEL = 'debug';

      const config = await envConfig.getAuthConfig();

      expect(config.logLevel).toBe('DEBUG');
    });

    it('should warn and use default for invalid number values', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());

      process.env.DYNAMO_TABLE_NAME = 'test-table';
      process.env.JWT_SECRET_PARAMETER_NAME = '/test/jwt-secret';
      process.env.JWT_TTL_SECONDS = 'invalid-number';

      const config = await envConfig.getAuthConfig();

      expect(config.jwtTtlSeconds).toBe(3600); // default value
      expect(consoleSpy).toHaveBeenCalledWith(
        'Invalid number value for JWT_TTL_SECONDS: "invalid-number". Using default: 3600'
      );
    });
  });

  describe('isTestMode', () => {
    it('should return true for test environment', () => {
      process.env.NODE_ENV = 'test';
      expect(envConfig.isTestMode()).toBe(true);
    });

    it('should return true for testing environment', () => {
      process.env.NODE_ENV = 'testing';
      expect(envConfig.isTestMode()).toBe(true);
    });

    it('should return false for non-test environments', () => {
      process.env.NODE_ENV = 'production';
      expect(envConfig.isTestMode()).toBe(false);
    });
  });

  describe('getEnvironment', () => {
    it('should return NODE_ENV value', () => {
      process.env.NODE_ENV = 'production';
      expect(envConfig.getEnvironment()).toBe('production');
    });

    it('should default to development when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;
      expect(envConfig.getEnvironment()).toBe('development');
    });
  });
});
