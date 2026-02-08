import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { ContractSummary } from '../../../types/api';

type UseContractsOptions = {
  updatedSince?: string;
  enabled?: boolean;
  refetchInterval?: number | false;
};

type ContractsError = Error & { status?: number };

const makeError = (message: string, status?: number): ContractsError => {
  const error = new Error(message) as ContractsError;
  error.status = status;
  return error;
};

export function useContracts(options: UseContractsOptions = {}) {
  const { handleAuthError } = useAuthErrorHandler();
  const updatedSince = options.updatedSince;

  return useQuery<ContractSummary[], ContractsError>({
    queryKey: ['contracts', updatedSince ?? 'all'],
    queryFn: async (): Promise<ContractSummary[]> => {
      const response = await apiClient.banking.listContracts({
        query: updatedSince ? { updatedSince } : undefined,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to fetch contracts', response.status);
      }

      return response.body.items;
    },
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval ?? false,
    refetchOnMount: 'always',
    staleTime: 5 * 1000,
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
