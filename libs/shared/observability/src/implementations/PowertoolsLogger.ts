import { Logger as PowertoolsLoggerClass } from '@aws-lambda-powertools/logger';
import type { Logger } from '../interfaces/Logger';
import type { LoggerConfig } from '../types';

export class PowertoolsLogger implements Logger {
  private logger: PowertoolsLoggerClass;

  constructor(config: LoggerConfig) {
    this.logger = new PowertoolsLoggerClass({
      logLevel: config.level,
      serviceName: config.serviceName,
      environment: config.environment || 'development',
      persistentLogAttributes: {
        service: config.serviceName,
        environment: config.environment || 'development',
      },
    });
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.logger.info(message, ...(extra ? [{ extra }] : []));
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.logger.warn(message, ...(extra ? [{ extra }] : []));
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.logger.error(message, ...(extra ? [{ extra }] : []));
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    this.logger.debug(message, ...(extra ? [{ extra }] : []));
  }

  addContext(context: Record<string, unknown>): void {
    this.logger.appendPersistentKeys(context);
  }

  setCorrelationId(correlationId: string): void {
    this.logger.appendPersistentKeys({ correlationId });
  }
}
