import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';

export interface TransferMoneyRequest {
  sourceAccountId: string;
  destinationAccountNumber: string;
  amountMinor: number;
  description?: string;
}

export interface TransferMoneyResponse {
  txnId: string;
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
        throw new Error('Transfer failed');
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
