import { BaseConfiguration } from '@demo-blue/shared-config';
import type { BaseConfig } from '@demo-blue/shared-config';
import type { Configuration } from '../application/ports';

export interface AuthConfiguration extends BaseConfig {
  dynamoTableName: string;
  jwtSecretArn: string;
  jwtTtlSeconds: number;
  testUserTtlSeconds: number;
}

export class AuthEnvironmentConfiguration
  extends BaseConfiguration
  implements Configuration
{
  private readonly requiredVariables = [
    'AUTH_DYNAMO_TABLE_NAME',
    'JWT_SECRET_ARN',
  ];

  async getAuthConfig(): Promise<AuthConfiguration> {
    this.validateConfiguration(this.requiredVariables);

    return {
      ...this.getBaseConfig(),
      dynamoTableName: this.getRequiredStringEnv('AUTH_DYNAMO_TABLE_NAME'),
      jwtSecretArn: this.getRequiredStringEnv('JWT_SECRET_ARN'),
      jwtTtlSeconds: this.getNumberEnv('JWT_TTL_SECONDS', 3600),
      testUserTtlSeconds: this.getNumberEnv('TEST_USER_TTL_SECONDS', 86400),
      serviceName: this.getStringEnv('SERVICE_NAME', 'auth'),
      metricsNamespace: this.getStringEnv('METRICS_NAMESPACE', 'App/Auth'),
    };
  }

  protected performCustomValidation(errors: string[]): void {
    // Validate JWT TTL
    const jwtTtl = this.getNumberEnv('JWT_TTL_SECONDS', 3600);
    this.validateRange('JWT_TTL_SECONDS', jwtTtl, 1, 86400, errors);

    // Validate test user TTL
    const testUserTtl = this.getNumberEnv('TEST_USER_TTL_SECONDS', 86400);
    this.validateRange('TEST_USER_TTL_SECONDS', testUserTtl, 1, 604800, errors);

    // Validate log level
    this.validateLogLevel(errors);
  }
}
