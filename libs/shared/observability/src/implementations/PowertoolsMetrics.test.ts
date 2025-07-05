import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Metrics as PowertoolsMetricsClass } from '@aws-lambda-powertools/metrics';
import { PowertoolsMetrics } from './PowertoolsMetrics';
import { MetricUnit } from '../interfaces/Metrics';

vi.mock('@aws-lambda-powertools/metrics');

describe('PowertoolsMetrics', () => {
  let mockPowertoolsMetrics: any;
  let powertoolsMetrics: PowertoolsMetrics;

  beforeEach(() => {
    mockPowertoolsMetrics = {
      addMetric: vi.fn(),
      addMetadata: vi.fn(),
      publishStoredMetrics: vi.fn().mockResolvedValue(undefined),
      setDefaultDimensions: vi.fn(),
    };

    vi.mocked(PowertoolsMetricsClass).mockImplementation(
      () => mockPowertoolsMetrics
    );

    powertoolsMetrics = new PowertoolsMetrics({
      namespace: 'BankDemo/Auth',
      serviceName: 'auth-service',
      environment: 'test',
    });
  });

  describe('constructor', () => {
    it('should create PowertoolsMetrics with correct configuration', () => {
      expect(PowertoolsMetricsClass).toHaveBeenCalledWith({
        namespace: 'BankDemo/Auth',
        serviceName: 'auth-service',
        defaultDimensions: {
          service: 'auth-service',
          environment: 'test',
        },
      });
    });

    it('should default environment to development when not provided', () => {
      vi.clearAllMocks();

      new PowertoolsMetrics({
        namespace: 'TestApp/Core',
        serviceName: 'test-service',
      });

      expect(PowertoolsMetricsClass).toHaveBeenCalledWith({
        namespace: 'TestApp/Core',
        serviceName: 'test-service',
        defaultDimensions: {
          service: 'test-service',
          environment: 'development',
        },
      });
    });
  });

  describe('metric operations', () => {
    it('should add metric with correct parameters', () => {
      const name = 'UserSignUp';
      const unit: MetricUnit = 'Count';
      const value = 1;

      powertoolsMetrics.addMetric(name, unit, value);

      expect(mockPowertoolsMetrics.addMetric).toHaveBeenCalledWith(
        name,
        unit,
        value
      );
    });

    it('should add metadata with correct parameters', () => {
      const key = 'operation';
      const value = 'user-creation';

      powertoolsMetrics.addMetadata(key, value);

      expect(mockPowertoolsMetrics.addMetadata).toHaveBeenCalledWith(
        key,
        value
      );
    });

    it('should publish stored metrics', async () => {
      await powertoolsMetrics.publishStoredMetrics();

      expect(mockPowertoolsMetrics.publishStoredMetrics).toHaveBeenCalledTimes(
        1
      );
    });

    it('should set default dimensions', () => {
      const dimensions = { region: 'us-east-1', stage: 'prod' };

      powertoolsMetrics.setDefaultDimensions(dimensions);

      expect(mockPowertoolsMetrics.setDefaultDimensions).toHaveBeenCalledWith(
        dimensions
      );
    });
  });
});
