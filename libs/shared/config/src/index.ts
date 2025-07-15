// Error classes
export {
  ConfigurationValidationError,
  ConfigurationError,
} from './lib/ConfigurationError';

// Base configuration
export { BaseConfiguration } from './lib/BaseConfiguration';

// AWS resilience configuration
export type { AwsResilienceConfig } from './lib/AwsResilienceConfig';
export { AwsResilienceConfigBuilder } from './lib/AwsResilienceConfig';

// Common types
export type {
  BaseConfig,
  ValidationRule,
  EnvironmentVariable,
  ConfigurationSchema,
  AwsConfig,
  LogLevel,
} from './lib/types';
