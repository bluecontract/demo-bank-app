export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface BaseConfig {
  environment: string;
  serviceName: string;
  logLevel: LogLevel;
  metricsNamespace: string;
}

export interface ValidationRule {
  validator: (value: unknown) => boolean;
  message: string;
}

export interface EnvironmentVariable {
  name: string;
  required: boolean;
  defaultValue?: string;
  parser?: (value: string) => unknown;
  validator?: ValidationRule;
}

export interface ConfigurationSchema {
  required: string[];
  optional: EnvironmentVariable[];
  validation?: Record<string, ValidationRule>;
}

export interface AwsConfig {
  region: string;
  endpoint?: string;
}
