import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvironmentConfiguration } from './EnvironmentConfiguration';

describe('EnvironmentConfiguration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset NODE_ENV variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original NODE_ENV
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should create configuration with all required NODE_ENV variables', () => {
      process.env.BANKING_DYNAMO_TABLE_NAME = 'test-banking-table';
      process.env.NODE_ENV = 'test';
      process.env.SERVICE_NAME = 'banking-service';
      process.env.LOG_LEVEL = 'INFO';
      process.env.METRICS_NAMESPACE = 'TestBanking';

      const config = new EnvironmentConfiguration();

      expect(config.dynamoTableName).toBe('test-banking-table');
      expect(config.environment).toBe('test');
      expect(config.serviceName).toBe('banking-service');
      expect(config.logLevel).toBe('INFO');
      expect(config.metricsNamespace).toBe('TestBanking');
    });

    it('should use default values when NODE_ENV variables are not set', () => {
      delete process.env.BANKING_DYNAMO_TABLE_NAME;
      delete process.env.NODE_ENV;
      delete process.env.SERVICE_NAME;
      delete process.env.LOG_LEVEL;
      delete process.env.METRICS_NAMESPACE;

      const config = new EnvironmentConfiguration();

      expect(config.dynamoTableName).toBe('banking-table');
      expect(config.environment).toBe('development');
      expect(config.serviceName).toBe('banking');
      expect(config.logLevel).toBe('INFO');
      expect(config.metricsNamespace).toBe('Banking');
    });

    it('should handle different log levels', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const config1 = new EnvironmentConfiguration();
      expect(config1.logLevel).toBe('DEBUG');

      process.env.LOG_LEVEL = 'ERROR';
      const config2 = new EnvironmentConfiguration();
      expect(config2.logLevel).toBe('ERROR');
    });

    it('should handle production NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      process.env.BANKING_DYNAMO_TABLE_NAME = 'prod-banking-table';
      process.env.SERVICE_NAME = 'prod-banking-service';
      process.env.LOG_LEVEL = 'WARN';
      process.env.METRICS_NAMESPACE = 'ProdBanking';

      const config = new EnvironmentConfiguration();

      expect(config.environment).toBe('production');
      expect(config.dynamoTableName).toBe('prod-banking-table');
      expect(config.serviceName).toBe('prod-banking-service');
      expect(config.logLevel).toBe('WARN');
      expect(config.metricsNamespace).toBe('ProdBanking');
    });

    it('should trim whitespace from NODE_ENV variables', () => {
      process.env.BANKING_DYNAMO_TABLE_NAME = '  test-table  ';
      process.env.SERVICE_NAME = '  banking-service  ';
      process.env.METRICS_NAMESPACE = '  TestBanking  ';

      const config = new EnvironmentConfiguration();

      expect(config.dynamoTableName).toBe('test-table');
      expect(config.serviceName).toBe('banking-service');
      expect(config.metricsNamespace).toBe('TestBanking');
    });
  });

  describe('isDevelopment', () => {
    it('should return true for development NODE_ENV', () => {
      process.env.NODE_ENV = 'development';
      const config = new EnvironmentConfiguration();
      expect(config.isDevelopment()).toBe(true);
    });

    it('should return false for production NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      const config = new EnvironmentConfiguration();
      expect(config.isDevelopment()).toBe(false);
    });

    it('should return false for test NODE_ENV', () => {
      process.env.NODE_ENV = 'test';
      const config = new EnvironmentConfiguration();
      expect(config.isDevelopment()).toBe(false);
    });
  });

  describe('isProduction', () => {
    it('should return true for production NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      const config = new EnvironmentConfiguration();
      expect(config.isProduction()).toBe(true);
    });

    it('should return false for development NODE_ENV', () => {
      process.env.NODE_ENV = 'development';
      const config = new EnvironmentConfiguration();
      expect(config.isProduction()).toBe(false);
    });

    it('should return false for test NODE_ENV', () => {
      process.env.NODE_ENV = 'test';
      const config = new EnvironmentConfiguration();
      expect(config.isProduction()).toBe(false);
    });
  });

  describe('validate', () => {
    it('should not throw for valid configuration', () => {
      process.env.BANKING_DYNAMO_TABLE_NAME = 'test-table';
      process.env.NODE_ENV = 'test';
      process.env.SERVICE_NAME = 'banking-service';

      expect(() => new EnvironmentConfiguration()).not.toThrow();
    });

    it('should handle empty string NODE_ENV variables as missing', () => {
      process.env.BANKING_DYNAMO_TABLE_NAME = '';
      process.env.SERVICE_NAME = '';

      const config = new EnvironmentConfiguration();

      // Should use defaults when empty strings are provided
      expect(config.dynamoTableName).toBe('banking-table');
      expect(config.serviceName).toBe('banking');
    });
  });
});
