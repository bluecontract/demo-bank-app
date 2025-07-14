import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';

export interface FundAccountRequest {
  accountId: string;
  amountMinor: number;
  description?: string;
}

export interface FundAccountResponse {
  txnId: string;
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
        throw new Error('Fund account failed');
      }

      return response.body;
    },
    onSuccess: data => {
      // Invalidate accounts query to refresh balances
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
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
