import type { Configuration } from '../application/ports';
import type { AuthConfiguration } from '../domain/types';
import { AppError } from '@demo-blue/shared-core';
import type { LogLevel } from '@demo-blue/shared-observability';

export class ConfigurationValidationError extends AppError {
  readonly code = 'CONFIGURATION_VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly missingVariables: string[],
    cause?: Error
  ) {
    super(message, { cause });
  }
}

export class EnvironmentConfiguration implements Configuration {
  private readonly requiredVariables = [
    'AUTH_DYNAMO_TABLE_NAME',
    'JWT_SECRET_ARN',
  ];

  async getAuthConfig(): Promise<AuthConfiguration> {
    this.validateConfiguration();

    return {
      dynamoTableName: this.getRequiredStringEnv('AUTH_DYNAMO_TABLE_NAME'),
      jwtSecretArn: this.getRequiredStringEnv('JWT_SECRET_ARN'),
      jwtTtlSeconds: this.getNumberEnv('JWT_TTL_SECONDS', 3600),
      testUserTtlSeconds: this.getNumberEnv('TEST_USER_TTL_SECONDS', 86400),
      environment: this.getEnvironment(),
      serviceName: this.getStringEnv('SERVICE_NAME', 'auth'),
      logLevel: this.getLogLevel(),
      metricsNamespace: this.getStringEnv('METRICS_NAMESPACE', 'App/Auth'),
    };
  }

  isTestMode(): boolean {
    const env = this.getEnvironment().toLowerCase();
    return env === 'test' || env === 'testing';
  }

  getEnvironment(): string {
    return this.getStringEnv('NODE_ENV', 'development');
  }

  private validateConfiguration(): void {
    const missingVariables: string[] = [];
    const validationErrors: string[] = [];

    // Check required variables
    for (const variable of this.requiredVariables) {
      const value = process.env[variable];
      if (!value || value.trim() === '') {
        missingVariables.push(variable);
      }
    }

    // Validate specific formats and constraints
    const jwtTtl = this.getNumberEnv('JWT_TTL_SECONDS', 3600);
    if (jwtTtl <= 0 || jwtTtl > 86400) {
      // Max 24 hours
      validationErrors.push(
        'JWT_TTL_SECONDS must be between 1 and 86400 seconds (24 hours)'
      );
    }

    const testUserTtl = this.getNumberEnv('TEST_USER_TTL_SECONDS', 86400);
    if (testUserTtl <= 0 || testUserTtl > 604800) {
      // Max 7 days
      validationErrors.push(
        'TEST_USER_TTL_SECONDS must be between 1 and 604800 seconds (7 days)'
      );
    }

    const logLevelRaw = this.getStringEnv('LOG_LEVEL', 'INFO').toUpperCase();
    const validLogLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    if (process.env.LOG_LEVEL && !validLogLevels.includes(logLevelRaw)) {
      validationErrors.push(
        `LOG_LEVEL must be one of: ${validLogLevels.join(', ')}`
      );
    }

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

  private getRequiredStringEnv(key: string): string {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      throw new ConfigurationValidationError(
        `Required environment variable ${key} is missing or empty`,
        [key]
      );
    }
    return value.trim();
  }

  private getStringEnv(key: string, defaultValue: string): string {
    const value = process.env[key];
    return value && value.trim() !== '' ? value.trim() : defaultValue;
  }

  private getNumberEnv(key: string, defaultValue: number): number {
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

  private getLogLevel(): LogLevel {
    const level = this.getStringEnv('LOG_LEVEL', 'INFO').toUpperCase();
    const validLevels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    return validLevels.includes(level as LogLevel)
      ? (level as LogLevel)
      : 'INFO';
  }
}
