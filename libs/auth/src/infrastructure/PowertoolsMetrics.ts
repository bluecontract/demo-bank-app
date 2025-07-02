import { Metrics as PowertoolsMetricsClass } from '@aws-lambda-powertools/metrics';
import { Metrics, MetricsConfig, MetricUnit } from '../domain/services/Metrics';

export class PowertoolsMetrics implements Metrics {
  private metrics: PowertoolsMetricsClass;

  constructor(config: MetricsConfig) {
    this.metrics = new PowertoolsMetricsClass({
      namespace: config.namespace,
      serviceName: config.serviceName,
      defaultDimensions: {
        service: config.serviceName,
        environment: config.environment || 'development',
      },
    });
  }

  addMetric(name: string, unit: MetricUnit, value: number): void {
    this.metrics.addMetric(name, unit, value);
  }

  addMetadata(key: string, value: string): void {
    this.metrics.addMetadata(key, value);
  }

  async publishStoredMetrics(): Promise<void> {
    await this.metrics.publishStoredMetrics();
  }

  setDefaultDimensions(dimensions: Record<string, string>): void {
    this.metrics.setDefaultDimensions(dimensions);
  }
}
