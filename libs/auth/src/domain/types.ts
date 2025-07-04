export interface AuthConfiguration {
  dynamoTableName: string;
  jwtSecretArn: string;
  jwtTtlSeconds: number;
  testUserTtlSeconds: number;
  environment: string;
  serviceName: string;
  logLevel: string;
  metricsNamespace: string;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LoggerConfig {
  level: LogLevel;
  serviceName: string;
  environment?: string;
}

export type MetricUnit =
  | 'Seconds'
  | 'Microseconds'
  | 'Milliseconds'
  | 'Count'
  | 'Bytes'
  | 'Kilobytes'
  | 'Megabytes'
  | 'Gigabytes'
  | 'Percent';

export interface MetricsConfig {
  namespace: string;
  serviceName: string;
  environment?: string;
}
