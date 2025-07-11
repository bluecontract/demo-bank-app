import type { BankingConfiguration, LogLevel } from '../domain/types';

export class EnvironmentConfiguration implements BankingConfiguration {
  readonly dynamoTableName: string;
  readonly environment: string;
  readonly serviceName: string;
  readonly logLevel: LogLevel;
  readonly metricsNamespace: string;

  constructor() {
    this.dynamoTableName = this.getEnvVar(
      'BANKING_DYNAMO_TABLE_NAME',
      'banking-table'
    );
    this.environment = this.getEnvVar('NODE_ENV', 'development');
    this.serviceName = this.getEnvVar('SERVICE_NAME', 'banking');
    this.logLevel = this.getEnvVar('LOG_LEVEL', 'INFO') as LogLevel;
    this.metricsNamespace = this.getEnvVar('METRICS_NAMESPACE', 'Banking');
  }

  private getEnvVar(name: string, defaultValue: string): string {
    const value = process.env[name];
    if (!value || value.trim() === '') {
      return defaultValue;
    }
    return value.trim();
  }

  isDevelopment(): boolean {
    return this.environment === 'development';
  }

  isProduction(): boolean {
    return this.environment === 'production';
  }
}
