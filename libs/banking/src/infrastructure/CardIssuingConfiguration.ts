import { BaseConfiguration } from '@demo-bank-app/shared-config';
import type { BaseConfig } from '@demo-bank-app/shared-config';

export interface CardIssuingConfiguration extends BaseConfig {
  cardPanSecret: string;
  cardCvcSecret: string;
  cardProcessorToken: string;
  cardBinPrefix: string;
  cardSettlementAccountId: string;
  cardSettlementAccountNumber: string;
}

export class CardIssuingEnvironmentConfiguration
  extends BaseConfiguration
  implements CardIssuingConfiguration
{
  readonly cardPanSecret: string;
  readonly cardCvcSecret: string;
  readonly cardProcessorToken: string;
  readonly cardBinPrefix: string;
  readonly cardSettlementAccountId: string;
  readonly cardSettlementAccountNumber: string;
  readonly environment: string;
  readonly serviceName: string;
  readonly logLevel: BaseConfig['logLevel'];
  readonly metricsNamespace: string;

  constructor() {
    super();

    const baseConfig = this.getBaseConfig();
    this.environment = baseConfig.environment;
    this.serviceName = this.getStringEnv('SERVICE_NAME', 'banking');
    this.logLevel = baseConfig.logLevel;
    this.metricsNamespace = this.getStringEnv('METRICS_NAMESPACE', 'Banking');

    this.cardPanSecret = this.getStringEnv(
      'CARD_PAN_SECRET',
      'demo-bank-pan-secret'
    );
    this.cardCvcSecret = this.getStringEnv(
      'CARD_CVC_SECRET',
      'demo-bank-cvc-secret'
    );
    this.cardProcessorToken = this.getStringEnv(
      'CARD_PROCESSOR_TOKEN',
      'demo-bank-processor-token'
    );
    this.cardBinPrefix = this.getStringEnv('CARD_BIN_PREFIX', '123456');
    this.cardSettlementAccountId = this.getStringEnv(
      'CARD_SETTLEMENT_ACCOUNT_ID',
      'CARD_SETTLEMENT'
    );
    this.cardSettlementAccountNumber = this.getStringEnv(
      'CARD_SETTLEMENT_ACCOUNT_NUMBER',
      '9999999999'
    );

    this.validateConfiguration([]);
  }

  protected performCustomValidation(errors: string[]): void {
    this.validateLogLevel(errors);

    if (!/^\d+$/.test(this.cardBinPrefix)) {
      errors.push('CARD_BIN_PREFIX must be numeric');
    }

    if (!/^\d{10}$/.test(this.cardSettlementAccountNumber)) {
      errors.push('CARD_SETTLEMENT_ACCOUNT_NUMBER must be 10 digits');
    }
  }
}
