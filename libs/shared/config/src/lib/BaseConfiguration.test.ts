import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BaseConfiguration } from './BaseConfiguration';
import { ConfigurationValidationError } from './ConfigurationError';

class TestConfiguration extends BaseConfiguration {
  private testRequiredVariables: string[] = [];

  setRequiredVariables(variables: string[]) {
    this.testRequiredVariables = variables;
  }

  testValidateConfiguration() {
    this.validateConfiguration(this.testRequiredVariables);
  }

  protected performCustomValidation(_errors: string[]): void {
    void _errors;
    // Test implementation can add custom validation
  }

  // Expose protected methods for testing
  public testGetRequiredStringEnv(key: string) {
    return this.getRequiredStringEnv(key);
  }

  public testGetStringEnv(key: string, defaultValue: string) {
    return this.getStringEnv(key, defaultValue);
  }

  public testGetNumberEnv(key: string, defaultValue: number) {
    return this.getNumberEnv(key, defaultValue);
  }

  public testGetBooleanEnv(key: string, defaultValue: boolean) {
    return this.getBooleanEnv(key, defaultValue);
  }

  public testGetLogLevel() {
    return this.getLogLevel();
  }

  public testGetBaseConfig() {
    return this.getBaseConfig();
  }

  public testGetAwsConfig() {
    return this.getAwsConfig();
  }

  public testValidateRange(
    key: string,
    value: number,
    min: number,
    max: number,
    errors: string[]
  ) {
    return this.validateRange(key, value, min, max, errors);
  }

  public testValidateLogLevel(errors: string[]) {
    return this.validateLogLevel(errors);
  }
}

describe('BaseConfiguration', () => {
  let config: TestConfiguration;
  const originalEnv = process.env;

  beforeEach(() => {
    config = new TestConfiguration();
    process.env = { ...originalEnv };
    // Reset env vars to avoid local/dev environment interference
    for (const key of [
      'NODE_ENV',
      'SERVICE_NAME',
      'LOG_LEVEL',
      'METRICS_NAMESPACE',
      'AWS_REGION',
      'AWS_ENDPOINT_URL',
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getRequiredStringEnv', () => {
    it('should return value when environment variable is set', () => {
      process.env.TEST_VAR = 'test-value';
      expect(config.testGetRequiredStringEnv('TEST_VAR')).toBe('test-value');
    });

    it('should trim whitespace from environment variable', () => {
      process.env.TEST_VAR = '  test-value  ';
      expect(config.testGetRequiredStringEnv('TEST_VAR')).toBe('test-value');
    });

    it('should throw ConfigurationValidationError when variable is missing', () => {
      expect(() => config.testGetRequiredStringEnv('MISSING_VAR')).toThrow(
        ConfigurationValidationError
      );
    });

    it('should throw ConfigurationValidationError when variable is empty', () => {
      process.env.TEST_VAR = '';
      expect(() => config.testGetRequiredStringEnv('TEST_VAR')).toThrow(
        ConfigurationValidationError
      );
    });

    it('should throw ConfigurationValidationError when variable is whitespace only', () => {
      process.env.TEST_VAR = '   ';
      expect(() => config.testGetRequiredStringEnv('TEST_VAR')).toThrow(
        ConfigurationValidationError
      );
    });
  });

  describe('getStringEnv', () => {
    it('should return value when environment variable is set', () => {
      process.env.TEST_VAR = 'test-value';
      expect(config.testGetStringEnv('TEST_VAR', 'default')).toBe('test-value');
    });

    it('should return default value when environment variable is not set', () => {
      expect(config.testGetStringEnv('MISSING_VAR', 'default')).toBe('default');
    });

    it('should return default value when environment variable is empty', () => {
      process.env.TEST_VAR = '';
      expect(config.testGetStringEnv('TEST_VAR', 'default')).toBe('default');
    });

    it('should trim whitespace from environment variable', () => {
      process.env.TEST_VAR = '  test-value  ';
      expect(config.testGetStringEnv('TEST_VAR', 'default')).toBe('test-value');
    });
  });

  describe('getNumberEnv', () => {
    it('should return parsed number when environment variable is set', () => {
      process.env.TEST_VAR = '42';
      expect(config.testGetNumberEnv('TEST_VAR', 10)).toBe(42);
    });

    it('should return default value when environment variable is not set', () => {
      expect(config.testGetNumberEnv('MISSING_VAR', 10)).toBe(10);
    });

    it('should return default value when environment variable is empty', () => {
      process.env.TEST_VAR = '';
      expect(config.testGetNumberEnv('TEST_VAR', 10)).toBe(10);
    });

    it('should return default value when environment variable is not a number', () => {
      process.env.TEST_VAR = 'not-a-number';
      expect(config.testGetNumberEnv('TEST_VAR', 10)).toBe(10);
    });

    it('should handle negative numbers', () => {
      process.env.TEST_VAR = '-42';
      expect(config.testGetNumberEnv('TEST_VAR', 10)).toBe(-42);
    });
  });

  describe('getBooleanEnv', () => {
    it('should return true for "true"', () => {
      process.env.TEST_VAR = 'true';
      expect(config.testGetBooleanEnv('TEST_VAR', false)).toBe(true);
    });

    it('should return true for "1"', () => {
      process.env.TEST_VAR = '1';
      expect(config.testGetBooleanEnv('TEST_VAR', false)).toBe(true);
    });

    it('should return false for "false"', () => {
      process.env.TEST_VAR = 'false';
      expect(config.testGetBooleanEnv('TEST_VAR', true)).toBe(false);
    });

    it('should return false for "0"', () => {
      process.env.TEST_VAR = '0';
      expect(config.testGetBooleanEnv('TEST_VAR', true)).toBe(false);
    });

    it('should return default value for other values', () => {
      process.env.TEST_VAR = 'maybe';
      expect(config.testGetBooleanEnv('TEST_VAR', true)).toBe(false);
    });

    it('should return default value when environment variable is not set', () => {
      expect(config.testGetBooleanEnv('MISSING_VAR', true)).toBe(true);
    });

    it('should handle case insensitivity', () => {
      process.env.TEST_VAR = 'TRUE';
      expect(config.testGetBooleanEnv('TEST_VAR', false)).toBe(true);
    });
  });

  describe('getLogLevel', () => {
    it('should return valid log level when set', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      expect(config.testGetLogLevel()).toBe('DEBUG');
    });

    it('should return INFO as default when LOG_LEVEL is not set', () => {
      expect(config.testGetLogLevel()).toBe('INFO');
    });

    it('should return INFO when LOG_LEVEL is invalid', () => {
      process.env.LOG_LEVEL = 'INVALID';
      expect(config.testGetLogLevel()).toBe('INFO');
    });

    it('should handle lowercase log levels', () => {
      process.env.LOG_LEVEL = 'debug';
      expect(config.testGetLogLevel()).toBe('DEBUG');
    });
  });

  describe('getBaseConfig', () => {
    it('should return base configuration with defaults', () => {
      const baseConfig = config.testGetBaseConfig();
      expect(baseConfig).toEqual({
        environment: 'development',
        serviceName: 'unknown',
        logLevel: 'INFO',
        metricsNamespace: 'App',
      });
    });

    it('should return base configuration with custom values', () => {
      process.env.NODE_ENV = 'production';
      process.env.SERVICE_NAME = 'my-service';
      process.env.LOG_LEVEL = 'ERROR';
      process.env.METRICS_NAMESPACE = 'Custom';

      const baseConfig = config.testGetBaseConfig();
      expect(baseConfig).toEqual({
        environment: 'production',
        serviceName: 'my-service',
        logLevel: 'ERROR',
        metricsNamespace: 'Custom',
      });
    });
  });

  describe('getAwsConfig', () => {
    it('should return AWS configuration with defaults', () => {
      const awsConfig = config.testGetAwsConfig();
      expect(awsConfig).toEqual({
        region: 'eu-west-1',
        endpoint: undefined,
      });
    });

    it('should return AWS configuration with custom values', () => {
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_ENDPOINT_URL = 'http://localhost:4566';

      const awsConfig = config.testGetAwsConfig();
      expect(awsConfig).toEqual({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
      });
    });
  });

  describe('validateRange', () => {
    it('should not add error when value is within range', () => {
      const errors: string[] = [];
      config.testValidateRange('TEST_VAR', 5, 1, 10, errors);
      expect(errors).toHaveLength(0);
    });

    it('should add error when value is below minimum', () => {
      const errors: string[] = [];
      config.testValidateRange('TEST_VAR', 0, 1, 10, errors);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe('TEST_VAR must be between 1 and 10 (got 0)');
    });

    it('should add error when value is above maximum', () => {
      const errors: string[] = [];
      config.testValidateRange('TEST_VAR', 11, 1, 10, errors);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe('TEST_VAR must be between 1 and 10 (got 11)');
    });
  });

  describe('validateLogLevel', () => {
    it('should not add error when LOG_LEVEL is valid', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const errors: string[] = [];
      config.testValidateLogLevel(errors);
      expect(errors).toHaveLength(0);
    });

    it('should add error when LOG_LEVEL is invalid', () => {
      process.env.LOG_LEVEL = 'INVALID';
      const errors: string[] = [];
      config.testValidateLogLevel(errors);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe(
        'LOG_LEVEL must be one of: DEBUG, INFO, WARN, ERROR'
      );
    });

    it('should not add error when LOG_LEVEL is not set', () => {
      const errors: string[] = [];
      config.testValidateLogLevel(errors);
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateConfiguration', () => {
    it('should not throw when all required variables are set', () => {
      process.env.REQ_VAR1 = 'value1';
      process.env.REQ_VAR2 = 'value2';
      config.setRequiredVariables(['REQ_VAR1', 'REQ_VAR2']);

      expect(() => config.testValidateConfiguration()).not.toThrow();
    });

    it('should throw ConfigurationValidationError when required variables are missing', () => {
      config.setRequiredVariables(['REQ_VAR1', 'REQ_VAR2']);

      expect(() => config.testValidateConfiguration()).toThrow(
        ConfigurationValidationError
      );
    });

    it('should include missing variables in error', () => {
      config.setRequiredVariables(['REQ_VAR1', 'REQ_VAR2']);

      try {
        config.testValidateConfiguration();
        expect.fail('Should have thrown ConfigurationValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationValidationError);
        const configError = error as ConfigurationValidationError;
        expect(configError.missingVariables).toEqual(['REQ_VAR1', 'REQ_VAR2']);
      }
    });
  });

  describe('environment methods', () => {
    it('should return correct environment', () => {
      process.env.NODE_ENV = 'production';
      expect(config.getEnvironment()).toBe('production');
    });

    it('should detect test mode', () => {
      process.env.NODE_ENV = 'test';
      expect(config.isTestMode()).toBe(true);

      process.env.NODE_ENV = 'testing';
      expect(config.isTestMode()).toBe(true);

      process.env.NODE_ENV = 'production';
      expect(config.isTestMode()).toBe(false);
    });

    it('should detect development mode', () => {
      process.env.NODE_ENV = 'development';
      expect(config.isDevelopment()).toBe(true);

      process.env.NODE_ENV = 'production';
      expect(config.isDevelopment()).toBe(false);
    });

    it('should detect production mode', () => {
      process.env.NODE_ENV = 'production';
      expect(config.isProduction()).toBe(true);

      process.env.NODE_ENV = 'development';
      expect(config.isProduction()).toBe(false);
    });
  });
});
