import { AccountNumberGenerator } from '../application/ports';
import type { Logger, Metrics } from '../domain/types';
import { METRIC_NAMES, METRIC_UNITS } from '@demo-blue/shared-observability';

export class SimpleAccountNumberGenerator implements AccountNumberGenerator {
  private counter = 0;
  private logger?: Logger;
  private metrics?: Metrics;

  constructor(logger?: Logger, metrics?: Metrics) {
    this.logger = logger;
    this.metrics = metrics;
  }

  generate(): string {
    this.logger?.debug('Account number generation started');

    const timestamp = Date.now();
    this.counter = (this.counter + 1) % 1000;

    const timestampPart = timestamp % 10000000;
    const counterPart = this.counter.toString().padStart(3, '0');

    const accountNumber = (timestampPart.toString() + counterPart).padStart(
      10,
      '0'
    );

    this.metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_NUMBER_GENERATE,
      METRIC_UNITS.COUNT,
      1
    );

    this.logger?.debug('Account number generation completed', {
      accountNumber,
      timestamp,
      counter: this.counter,
    });

    return accountNumber;
  }
}
