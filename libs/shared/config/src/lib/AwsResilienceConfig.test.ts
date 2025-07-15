import { describe, it, expect } from 'vitest';
import { AwsResilienceConfigBuilder } from './AwsResilienceConfig';

describe('AwsResilienceConfigBuilder', () => {
  describe('forDynamoDB', () => {
    it('should return correct DynamoDB configuration', () => {
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
    it('should return correct Secrets Manager configuration', () => {
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
    it('should convert AwsResilienceConfig to AWS SDK format', () => {
      const resilienceConfig = AwsResilienceConfigBuilder.forDynamoDB();
      const awsConfig =
        AwsResilienceConfigBuilder.toAwsConfig(resilienceConfig);

      expect(awsConfig).toEqual({
        maxAttempts: 3,
        retryMode: 'standard',
        requestTimeout: 5000,
      });
    });

    it('should convert custom AwsResilienceConfig to AWS SDK format', () => {
      const customConfig = {
        retry: {
          maxAttempts: 5,
          mode: 'adaptive' as const,
        },
        timeout: {
          requestTimeout: 8000,
        },
      };

      const awsConfig = AwsResilienceConfigBuilder.toAwsConfig(customConfig);

      expect(awsConfig).toEqual({
        maxAttempts: 5,
        retryMode: 'adaptive',
        requestTimeout: 8000,
      });
    });
  });
});
