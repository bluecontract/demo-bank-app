import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BankingEnvironmentConfiguration } from './BankingConfiguration';
import { ConfigurationValidationError } from '@demo-bank-app/shared-config';

describe('BankingEnvironmentConfiguration', () => {
  let config: BankingEnvironmentConfiguration;
  const originalEnv = process.env;

  beforeEach(() => {
    config = new BankingEnvironmentConfiguration();
    process.env = { ...originalEnv };
    // Reset NODE_ENV to avoid test environment interference
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('configuration properties', () => {
    it('should return banking configuration with all properties set', () => {
      process.env.BANKING_DYNAMO_TABLE_NAME = 'banking-table';
      process.env.NODE_ENV = 'production';
      process.env.SERVICE_NAME = 'my-banking-service';
      process.env.LOG_LEVEL = 'WARN';
      process.env.METRICS_NAMESPACE = 'MyApp/Banking';

      const bankingConfig = new BankingEnvironmentConfiguration();

      expect(bankingConfig.dynamoTableName).toBe('banking-table');
      expect(bankingConfig.environment).toBe('production');
      expect(bankingConfig.serviceName).toBe('my-banking-service');
      expect(bankingConfig.logLevel).toBe('WARN');
      expect(bankingConfig.metricsNamespace).toBe('MyApp/Banking');
    });

    it('should return banking configuration with defaults when optional variables are not set', () => {
      const bankingConfig = new BankingEnvironmentConfiguration();

      expect(bankingConfig.dynamoTableName).toBe('banking-table');
      expect(bankingConfig.environment).toBe('development');
      expect(bankingConfig.serviceName).toBe('banking');
      expect(bankingConfig.logLevel).toBe('INFO');
      expect(bankingConfig.metricsNamespace).toBe('Banking');
    });

    it('should throw ConfigurationValidationError when LOG_LEVEL is invalid', () => {
      process.env.LOG_LEVEL = 'INVALID_LEVEL';

      expect(() => new BankingEnvironmentConfiguration()).toThrow(
        ConfigurationValidationError
      );
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
