import { initClient, tsRestFetchApi, type ApiFetcher } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';

export interface ApiClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}

type RedirectWindow = {
  location?: {
    assign?: (url: string) => void;
  };
};

const redirectIfUnauthorized = (status: number) => {
  if (status !== 401 && status !== 403) {
    return;
  }

  const globalObj = typeof globalThis !== 'undefined' ? globalThis : undefined;
  const currentWindow = (globalObj as { window?: RedirectWindow })?.window;
  const assign = currentWindow?.location?.assign;

  if (typeof assign === 'function') {
    assign('/');
  }
};

const redirectUnauthorizedFetcher: ApiFetcher = async args => {
  const response = await tsRestFetchApi(args);

  redirectIfUnauthorized(response.status);

  return response;
};

export function createApiClient(config: ApiClientConfig) {
  return initClient(bankApiContract, {
    baseUrl: config.baseUrl,
    baseHeaders: config.headers || {},
    credentials: 'include',
    api: redirectUnauthorizedFetcher,
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
