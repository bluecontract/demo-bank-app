import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { Account } from '../../../types/api';

export interface SetCreditLimitRequest {
  accountId: string;
  creditLimitMinor: number;
}

interface UseSetCreditLimitOptions {
  onSuccess?: (data: Account) => void;
  onError?: (error: Error) => void;
}

export function useSetCreditLimit(options?: UseSetCreditLimitOptions) {
  const { handleAuthError } = useAuthErrorHandler();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: SetCreditLimitRequest): Promise<Account> => {
      const { accountId, creditLimitMinor } = data;
      const response = await apiClient.banking.setCreditLimit({
        params: { accountId },
        body: { creditLimitMinor },
        overrideClientOptions: {
          credentials: 'include',
        },
      });

      if (response.status !== 200) {
        const error = new Error('Credit limit update failed') as Error & {
          status: number;
          body?: unknown;
        };
        error.status = response.status;
        error.body = response.body;
        throw error;
      }

      return response.body;
    },
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      options?.onSuccess?.(data);
    },
    onError: error => {
      if (!handleAuthError(error)) {
        options?.onError?.(error);
      }
    },
  });
}
