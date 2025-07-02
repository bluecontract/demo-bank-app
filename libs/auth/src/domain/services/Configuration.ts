export interface AuthConfiguration {
  dynamoTableName: string;
  jwtSecretParameterName: string;
  jwtTtlSeconds: number;
  testUserTtlSeconds: number;
  environment: string;
  serviceName: string;
  logLevel: string;
  metricsNamespace: string;
}

export interface Configuration {
  getAuthConfig(): Promise<AuthConfiguration>;
  isTestMode(): boolean;
  getEnvironment(): string;
}
