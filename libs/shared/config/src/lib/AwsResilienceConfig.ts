interface RetryConfig {
  maxAttempts: number;
  mode: 'standard' | 'adaptive';
}

interface TimeoutConfig {
  requestTimeout: number;
}

export interface AwsResilienceConfig {
  retry: RetryConfig;
  timeout: TimeoutConfig;
}

export class AwsResilienceConfigBuilder {
  static forDynamoDB(): AwsResilienceConfig {
    return {
      retry: {
        maxAttempts: 3,
        mode: 'standard',
      },
      timeout: {
        requestTimeout: 5000, // 5 seconds
      },
    };
  }

  static forSecretsManager(): AwsResilienceConfig {
    return {
      retry: {
        maxAttempts: 3,
        mode: 'standard',
      },
      timeout: {
        requestTimeout: 10000, // 10 seconds for secret retrieval
      },
    };
  }

  static toAwsConfig(config: AwsResilienceConfig) {
    return {
      maxAttempts: config.retry.maxAttempts,
      retryMode: config.retry.mode,
      requestTimeout: config.timeout.requestTimeout,
    };
  }
}
