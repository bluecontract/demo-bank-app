import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { ContractOperationResponse } from '../../../types/api';

type ContractArchiveError = Error & { status?: number };

const makeError = (message: string, status?: number): ContractArchiveError => {
  const error = new Error(message) as ContractArchiveError;
  error.status = status;
  return error;
};

export function useArchiveContract() {
  const queryClient = useQueryClient();
  const { handleAuthError } = useAuthErrorHandler();

  return useMutation<
    ContractOperationResponse,
    ContractArchiveError,
    { sessionId: string; body?: unknown }
  >({
    mutationFn: async ({ sessionId, body }) => {
      const response = await apiClient.banking.archiveContract({
        params: { sessionId },
        body,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to archive contract', response.status);
      }

      return response.body;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({
        queryKey: ['contract-details', variables.sessionId],
      });
      queryClient.invalidateQueries({ queryKey: ['transaction-contracts'] });
      queryClient.invalidateQueries({ queryKey: ['hold-contracts'] });
    },
    throwOnError: error => {
      if (!handleAuthError(error)) {
        return true;
      }
      return false;
    },
  });
}
