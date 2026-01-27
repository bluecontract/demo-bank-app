import { BaseConfiguration } from '@demo-bank-app/shared-config';
import type { BaseConfig } from '@demo-bank-app/shared-config';

export interface BankingConfiguration extends BaseConfig {
  dynamoTableName: string;
  defaultMerchantCreditLimitMinor: number;
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
  readonly defaultMerchantCreditLimitMinor: number;

  constructor() {
    super();

    // Validate configuration first
    this.validateConfiguration([]);

    const baseConfig = this.getBaseConfig();
    this.dynamoTableName = this.getStringEnv(
      'BANKING_DYNAMO_TABLE_NAME',
      'banking-table'
    );
    this.defaultMerchantCreditLimitMinor = this.getNumberEnv(
      'DEFAULT_MERCHANT_CREDIT_LIMIT_MINOR',
      500_000
    );
    this.environment = baseConfig.environment;
    this.serviceName = this.getStringEnv('SERVICE_NAME', 'banking');
    this.logLevel = baseConfig.logLevel;
    this.metricsNamespace = this.getStringEnv('METRICS_NAMESPACE', 'Banking');
  }

  protected performCustomValidation(errors: string[]): void {
    const defaultCreditLimit = this.getNumberEnv(
      'DEFAULT_MERCHANT_CREDIT_LIMIT_MINOR',
      500_000
    );
    this.validateRange(
      'DEFAULT_MERCHANT_CREDIT_LIMIT_MINOR',
      defaultCreditLimit,
      0,
      100_000_000,
      errors
    );
    // Validate log level
    this.validateLogLevel(errors);
  }
}
