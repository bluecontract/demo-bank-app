import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { ContractHistoryResponse } from '../../../types/api';

type ContractHistoryError = Error & { status?: number };

const makeError = (message: string, status?: number): ContractHistoryError => {
  const error = new Error(message) as ContractHistoryError;
  error.status = status;
  return error;
};

export function useContractHistory(sessionId: string | null, enabled = true) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<ContractHistoryResponse, ContractHistoryError>({
    queryKey: ['contract-history', sessionId ?? 'unknown'],
    queryFn: async () => {
      if (!sessionId) {
        throw makeError('Session id is required');
      }

      const response = await apiClient.banking.listContractHistory({
        params: { sessionId },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status === 404) {
        return { items: [] };
      }

      if (response.status !== 200) {
        throw makeError('Failed to load contract history', response.status);
      }

      return response.body;
    },
    enabled: Boolean(sessionId) && enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error.status === 401 || error.status === 403) {
        return false;
      }
      return failureCount < 1;
    },
    throwOnError: error => {
      handleAuthError(error);
      return false;
    },
  });
}
