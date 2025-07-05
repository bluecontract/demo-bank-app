import React, { createContext, useContext } from 'react';
import { apiClient } from '../../api/client';
import type { ApiClient } from '@demo-blue/shared-bank-api-client';

const ApiContext = createContext<ApiClient | undefined>(undefined);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  return (
    <ApiContext.Provider value={apiClient}>{children}</ApiContext.Provider>
  );
}

export function useApiClient() {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error('useApiClient must be used within ApiProvider');
  }
  return client;
}
