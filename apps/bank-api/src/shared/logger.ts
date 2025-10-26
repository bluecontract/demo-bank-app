import {
  PowertoolsLogger,
  LogLevel,
} from '@demo-bank-app/shared-observability';

let loggerInstance: PowertoolsLogger | null = null;

export const getLogger = (): PowertoolsLogger => {
  if (!loggerInstance) {
    loggerInstance = new PowertoolsLogger({
      serviceName: process.env.SERVICE_NAME || 'bank-api',
      level: (process.env.LOG_LEVEL as unknown as LogLevel) || 'INFO',
    });
  }
  return loggerInstance;
};
