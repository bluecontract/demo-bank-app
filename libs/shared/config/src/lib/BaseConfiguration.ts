import { ConfigurationValidationError } from './ConfigurationError';
import type { BaseConfig, LogLevel, AwsConfig } from './types';

export abstract class BaseConfiguration {
  protected validateConfiguration(requiredVariables: string[]): void {
    const missingVariables: string[] = [];
    const validationErrors: string[] = [];

    // Check required variables
    for (const variable of requiredVariables) {
      const value = process.env[variable];
      if (!value || value.trim() === '') {
        missingVariables.push(variable);
      }
    }

    // Custom validation
    this.performCustomValidation(validationErrors);

    // Report validation errors
    if (missingVariables.length > 0 || validationErrors.length > 0) {
      const errorMessages: string[] = [];

      if (missingVariables.length > 0) {
        errorMessages.push(
          `Missing required environment variables: ${missingVariables.join(
            ', '
          )}`
        );
      }

      if (validationErrors.length > 0) {
        errorMessages.push(...validationErrors);
      }

      throw new ConfigurationValidationError(
        `Configuration validation failed:\n- ${errorMessages.join('\n- ')}`,
        missingVariables
      );
    }
  }

  protected abstract performCustomValidation(errors: string[]): void;

  protected getRequiredStringEnv(key: string): string {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      throw new ConfigurationValidationError(
        `Required environment variable ${key} is missing or empty`,
        [key]
      );
    }
    return value.trim();
  }

  protected getStringEnv(key: string, defaultValue: string): string {
    const value = process.env[key];
    return value && value.trim() !== '' ? value.trim() : defaultValue;
  }

  protected getNumberEnv(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      return defaultValue;
    }

    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      console.warn(
        `Invalid number value for ${key}: "${value}". Using default: ${defaultValue}`
      );
      return defaultValue;
    }

    return parsed;
  }

  protected getBooleanEnv(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      return defaultValue;
    }

    const normalizedValue = value.trim().toLowerCase();
    return normalizedValue === 'true' || normalizedValue === '1';
  }

  protected getLogLevel(): LogLevel {
    const level = this.getStringEnv('LOG_LEVEL', 'INFO').toUpperCase();
    const validLevels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    return validLevels.includes(level as LogLevel)
      ? (level as LogLevel)
      : 'INFO';
  }

  protected getBaseConfig(): BaseConfig {
    return {
      environment: this.getEnvironment(),
      serviceName: this.getStringEnv('SERVICE_NAME', 'unknown'),
      logLevel: this.getLogLevel(),
      metricsNamespace: this.getStringEnv('METRICS_NAMESPACE', 'App'),
    };
  }

  protected getAwsConfig(): AwsConfig {
    return {
      region: this.getStringEnv('AWS_REGION', 'eu-central-1'),
      endpoint: process.env.AWS_ENDPOINT_URL,
    };
  }

  protected validateRange(
    key: string,
    value: number,
    min: number,
    max: number,
    errors: string[]
  ): void {
    if (value < min || value > max) {
      errors.push(`${key} must be between ${min} and ${max} (got ${value})`);
    }
  }

  protected validateLogLevel(errors: string[]): void {
    const logLevelRaw = this.getStringEnv('LOG_LEVEL', 'INFO').toUpperCase();
    const validLogLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    if (process.env.LOG_LEVEL && !validLogLevels.includes(logLevelRaw)) {
      errors.push(`LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`);
    }
  }

  getEnvironment(): string {
    return this.getStringEnv('NODE_ENV', 'development');
  }

  isTestMode(): boolean {
    const env = this.getEnvironment().toLowerCase();
    return env === 'test' || env === 'testing';
  }

  isDevelopment(): boolean {
    return this.getEnvironment() === 'development';
  }

  isProduction(): boolean {
    return this.getEnvironment() === 'production';
  }
}
