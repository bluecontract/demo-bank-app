import { describe, it, expect } from 'vitest';
import { AwsResilienceConfigBuilder } from './AwsResilienceConfig';

describe('AwsResilienceConfigBuilder', () => {
  describe('forDynamoDB', () => {
    it('should return correct configuration for DynamoDB', () => {
      const config = AwsResilienceConfigBuilder.forDynamoDB();

      expect(config).toEqual({
        retry: {
          maxAttempts: 3,
          mode: 'standard',
        },
        timeout: {
          requestTimeout: 5000,
        },
      });
    });
  });

  describe('forSecretsManager', () => {
    it('should return correct configuration for Secrets Manager', () => {
      const config = AwsResilienceConfigBuilder.forSecretsManager();

      expect(config).toEqual({
        retry: {
          maxAttempts: 3,
          mode: 'standard',
        },
        timeout: {
          requestTimeout: 10000,
        },
      });
    });
  });

  describe('toAwsConfig', () => {
    it('should convert resilience config to AWS SDK config format', () => {
      const resilienceConfig = {
        retry: {
          maxAttempts: 5,
          mode: 'adaptive' as const,
        },
        timeout: {
          requestTimeout: 8000,
        },
      };

      const awsConfig =
        AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig);

      expect(awsConfig).toEqual({
        maxAttempts: 5,
        retryMode: 'adaptive',
        requestTimeout: 8000,
      });
    });
  });
});
