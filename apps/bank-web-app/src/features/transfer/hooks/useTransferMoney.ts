import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { TransferMoneyResponse } from '../../../types/api';

export interface TransferMoneyRequest {
  sourceAccountId: string;
  destinationAccountNumber: string;
  amountMinor: number;
  description?: string;
}

interface UseTransferMoneyOptions {
  onSuccess?: (data: TransferMoneyResponse) => void;
  onError?: (error: Error) => void;
}

export function useTransferMoney(options?: UseTransferMoneyOptions) {
  const { handleAuthError } = useAuthErrorHandler();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      data: TransferMoneyRequest
    ): Promise<TransferMoneyResponse> => {
      const response = await apiClient.banking.transferMoney({
        headers: {
          'idempotency-key': crypto.randomUUID(),
        },
        body: data,
        overrideClientOptions: {
          credentials: 'include',
        },
      });

      if (response.status !== 201) {
        // Create error object that includes the response details
        const error = new Error('Transfer failed') as Error & {
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
      // Invalidate transactions query to refresh transaction history for source account
      queryClient.invalidateQueries({
        queryKey: ['transactions', variables.sourceAccountId],
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
