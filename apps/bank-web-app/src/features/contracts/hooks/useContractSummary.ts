import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { ContractSummaryGeneration } from '../../../types/api';

type ContractSummaryError = Error & { status?: number };

const makeError = (message: string, status?: number): ContractSummaryError => {
  const error = new Error(message) as ContractSummaryError;
  error.status = status;
  return error;
};

export function useContractSummary(
  sessionId: string | null,
  sourceUpdatedAt: string | null
) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<ContractSummaryGeneration, ContractSummaryError>({
    queryKey: [
      'contract-summary',
      sessionId ?? 'unknown',
      sourceUpdatedAt ?? 'unknown',
    ],
    queryFn: async (): Promise<ContractSummaryGeneration> => {
      if (!sessionId) {
        throw makeError('Session id is required');
      }

      const response = await apiClient.banking.generateContractSummary({
        params: { sessionId },
        body: undefined,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to generate contract summary', response.status);
      }

      return response.body;
    },
    enabled: Boolean(sessionId) && Boolean(sourceUpdatedAt),
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
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

export function useRegenerateContractSummary() {
  const queryClient = useQueryClient();
  const { handleAuthError } = useAuthErrorHandler();

  return useMutation<
    ContractSummaryGeneration,
    ContractSummaryError,
    { sessionId: string }
  >({
    mutationFn: async ({ sessionId }) => {
      const response = await apiClient.banking.generateContractSummary({
        params: { sessionId },
        body: { force: true },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError(
          'Failed to regenerate contract summary',
          response.status
        );
      }

      return response.body;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['contract-summary', variables.sessionId],
      });
      queryClient.invalidateQueries({
        queryKey: ['contract-details', variables.sessionId],
      });
    },
    throwOnError: error => {
      handleAuthError(error);
      return false;
    },
  });
}
