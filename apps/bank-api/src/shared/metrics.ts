import { PowertoolsMetrics } from '@demo-blue/shared-observability';

let metricsInstance: PowertoolsMetrics | null = null;

export const getMetrics = (): PowertoolsMetrics => {
  if (!metricsInstance) {
    metricsInstance = new PowertoolsMetrics({
      namespace: process.env.METRICS_NAMESPACE || 'BankApi',
      serviceName: process.env.SERVICE_NAME || 'bank-api',
    });
  }
  return metricsInstance;
};
