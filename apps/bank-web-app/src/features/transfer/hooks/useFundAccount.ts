import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { FundAccountResponse } from '../../../types/api';

export interface FundAccountRequest {
  accountId: string;
  amountMinor: number;
}

interface UseFundAccountOptions {
  onSuccess?: (data: FundAccountResponse) => void;
  onError?: (error: Error) => void;
}

export function useFundAccount(options?: UseFundAccountOptions) {
  const { handleAuthError } = useAuthErrorHandler();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      data: FundAccountRequest
    ): Promise<FundAccountResponse> => {
      const { accountId, ...body } = data;
      const response = await apiClient.banking.fundAccount({
        params: { accountId },
        headers: {
          'idempotency-key': crypto.randomUUID(),
        },
        body,
        overrideClientOptions: {
          credentials: 'include',
        },
      });

      if (response.status !== 201) {
        // Create error object that includes the response details
        const error = new Error('Fund account failed') as Error & {
          status: number;
          body: unknown;
        };
        error.status = response.status;
        error.body = response.body;
        throw error;
      }

      return response.body;
    },
    onSuccess: (data, variables) => {
      // Invalidate accounts query to refresh balances
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      // Invalidate transactions query to refresh transaction history
      queryClient.invalidateQueries({
        queryKey: ['transactions', variables.accountId],
      });
      options?.onSuccess?.(data);
    },
    onError: error => {
      // Try to handle auth errors first
      if (!handleAuthError(error)) {
        // If it's not an auth error, call the original error handler
        options?.onError?.(error);
      }
    },
  });
}
