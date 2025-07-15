import { BaseConfiguration } from '@demo-blue/shared-config';
import type { BaseConfig } from '@demo-blue/shared-config';

export interface BankingConfiguration extends BaseConfig {
  dynamoTableName: string;
}

export class BankingEnvironmentConfiguration
  extends BaseConfiguration
  implements BankingConfiguration
{
  readonly dynamoTableName: string;
  readonly environment: string;
  readonly serviceName: string;
  readonly logLevel: BaseConfig['logLevel'];
  readonly metricsNamespace: string;

  constructor() {
    super();

    // Validate configuration first
    this.validateConfiguration([]);

    const baseConfig = this.getBaseConfig();
    this.dynamoTableName = this.getStringEnv(
      'BANKING_DYNAMO_TABLE_NAME',
      'banking-table'
    );
    this.environment = baseConfig.environment;
    this.serviceName = this.getStringEnv('SERVICE_NAME', 'banking');
    this.logLevel = baseConfig.logLevel;
    this.metricsNamespace = this.getStringEnv('METRICS_NAMESPACE', 'Banking');
  }

  protected performCustomValidation(errors: string[]): void {
    // Validate log level
    this.validateLogLevel(errors);
  }
}
