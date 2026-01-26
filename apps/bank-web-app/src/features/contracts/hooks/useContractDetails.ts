import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { ContractDetails } from '../../../types/api';

type ContractDetailsError = Error & { status?: number };

const makeError = (message: string, status?: number): ContractDetailsError => {
  const error = new Error(message) as ContractDetailsError;
  error.status = status;
  return error;
};

export function useContractDetails(sessionId: string | null) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<ContractDetails, ContractDetailsError>({
    queryKey: ['contract-details', sessionId ?? 'unknown'],
    queryFn: async (): Promise<ContractDetails> => {
      if (!sessionId) {
        throw makeError('Session id is required');
      }

      const response = await apiClient.banking.getContractDetails({
        params: { sessionId },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to fetch contract details', response.status);
      }

      return response.body;
    },
    enabled: !!sessionId,
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error.status === 401 || error.status === 403) {
        return false;
      }
      return failureCount < 2;
    },
    throwOnError: error => {
      if (!handleAuthError(error)) {
        return true;
      }
      return false;
    },
  });
}
