import { initClient } from '@ts-rest/core';
import { bankApiContract } from '@demo-blue/shared-bank-api-contract';

export interface ApiClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}

export function createApiClient(config: ApiClientConfig) {
  return initClient(bankApiContract, {
    baseUrl: config.baseUrl,
    baseHeaders: config.headers || {},
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
