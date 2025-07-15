import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDependencies, resetDependencies } from './dependencies';
import {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-blue/shared-observability';

// Mock the auth module
vi.mock('@demo-blue/auth', () => ({
  DynamoUserRepository: vi.fn(() => ({ mockRepo: true })),
  AwsJwtService: vi.fn(() => ({ mockJwt: true })),
  PowertoolsLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
  PowertoolsMetrics: vi.fn(() => ({
    addMetric: vi.fn(),
    publishStoredMetrics: vi.fn(),
  })),
  AuthEnvironmentConfiguration: vi.fn(() => ({
    getAuthConfig: vi.fn().mockResolvedValue({
      dynamoTableName: 'test-table',
      jwtSecretArn: 'test-secret-arn',
      jwtTtlSeconds: 3600,
      testUserTtlSeconds: 600,
      environment: 'test',
      serviceName: 'test-service',
      logLevel: 'INFO',
      metricsNamespace: 'Test/Auth',
    }),
  })),
}));

describe('Dependencies Module', () => {
  beforeEach(() => {
    resetDependencies();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getDependencies', () => {
    it('should initialize dependencies on first call', async () => {
      const deps = await getDependencies();

      expect(deps).toBeDefined();
      expect(deps.userRepository).toBeDefined();
      expect(deps.jwtService).toBeDefined();
      expect(deps.logger).toBeInstanceOf(PowertoolsLogger);
      expect(deps.metrics).toBeInstanceOf(PowertoolsMetrics);
      expect(deps.config).toBeDefined();
      expect(deps.config.jwtTtlSeconds).toBe(3600);
      expect(deps.config.testUserTtlSeconds).toBe(600);
    });

    it('should return cached dependencies on subsequent calls', async () => {
      const deps1 = await getDependencies();
      const deps2 = await getDependencies();

      expect(deps1).toBe(deps2); // Should be the same object reference
    });

    it('should reinitialize after reset', async () => {
      const deps1 = await getDependencies();
      resetDependencies();
      const deps2 = await getDependencies();

      expect(deps1).not.toBe(deps2); // Should be different object references
    });
  });

  describe('resetDependencies', () => {
    it('should clear cached dependencies', async () => {
      await getDependencies(); // Initialize
      resetDependencies();

      // Next call should reinitialize
      const deps = await getDependencies();
      expect(deps).toBeDefined();
    });
  });
});
