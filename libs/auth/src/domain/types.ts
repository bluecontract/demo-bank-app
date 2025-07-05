export interface AuthConfiguration {
  dynamoTableName: string;
  jwtSecretArn: string;
  jwtTtlSeconds: number;
  testUserTtlSeconds: number;
  environment: string;
  serviceName: string;
  logLevel: LogLevel;
  metricsNamespace: string;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
