import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger as PowertoolsLoggerClass } from '@aws-lambda-powertools/logger';
import { PowertoolsLogger } from './PowertoolsLogger';

vi.mock('@aws-lambda-powertools/logger');

describe('PowertoolsLogger', () => {
  let mockPowertoolsLogger: any;
  let powertoolsLogger: PowertoolsLogger;

  beforeEach(() => {
    mockPowertoolsLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      appendPersistentKeys: vi.fn(),
    };

    vi.mocked(PowertoolsLoggerClass).mockImplementation(
      () => mockPowertoolsLogger
    );

    powertoolsLogger = new PowertoolsLogger({
      level: 'INFO',
      serviceName: 'auth-service',
      environment: 'test',
    });
  });

  describe('constructor', () => {
    it('should create PowertoolsLogger with correct configuration', () => {
      expect(PowertoolsLoggerClass).toHaveBeenCalledWith({
        logLevel: 'INFO',
        serviceName: 'auth-service',
        environment: 'test',
        persistentLogAttributes: {
          service: 'auth-service',
          environment: 'test',
        },
      });
    });

    it('should default environment to development when not provided', () => {
      vi.clearAllMocks();

      new PowertoolsLogger({
        level: 'DEBUG',
        serviceName: 'test-service',
      });

      expect(PowertoolsLoggerClass).toHaveBeenCalledWith({
        logLevel: 'DEBUG',
        serviceName: 'test-service',
        environment: 'development',
        persistentLogAttributes: {
          service: 'test-service',
          environment: 'development',
        },
      });
    });
  });

  describe('logging methods', () => {
    it('should log info messages with extra context', () => {
      const message = 'User created successfully';
      const extra = { userId: 'user-123', userEmail: 'john@example.com' };

      powertoolsLogger.info(message, extra);

      expect(mockPowertoolsLogger.info).toHaveBeenCalledWith(message, {
        extra,
      });
    });

    it('should log warn messages with extra context', () => {
      const message = 'Deprecated feature used';
      const extra = { feature: 'old-api', userId: 'user-123' };

      powertoolsLogger.warn(message, extra);

      expect(mockPowertoolsLogger.warn).toHaveBeenCalledWith(message, {
        extra,
      });
    });

    it('should log error messages with extra context', () => {
      const message = 'Database connection failed';
      const extra = { error: 'ConnectionTimeout', retryCount: 3 };

      powertoolsLogger.error(message, extra);

      expect(mockPowertoolsLogger.error).toHaveBeenCalledWith(message, {
        extra,
      });
    });

    it('should log debug messages with extra context', () => {
      const message = 'JWT token validated';
      const extra = { tokenLength: 256, algorithm: 'HS256' };

      powertoolsLogger.debug(message, extra);

      expect(mockPowertoolsLogger.debug).toHaveBeenCalledWith(message, {
        extra,
      });
    });

    it('should log messages without extra context', () => {
      const message = 'Simple log message';

      powertoolsLogger.info(message);

      expect(mockPowertoolsLogger.info).toHaveBeenCalledWith(message);
    });
  });

  describe('context management', () => {
    it('should add persistent context', () => {
      const context = { requestId: 'req-123', userId: 'user-456' };

      powertoolsLogger.addContext(context);

      expect(mockPowertoolsLogger.appendPersistentKeys).toHaveBeenCalledWith(
        context
      );
    });

    it('should set correlation ID as persistent attribute', () => {
      const correlationId = 'corr-789';

      powertoolsLogger.setCorrelationId(correlationId);

      expect(mockPowertoolsLogger.appendPersistentKeys).toHaveBeenCalledWith({
        correlationId,
      });
    });
  });
});
