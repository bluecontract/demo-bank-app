import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { ClientInferResponseBody } from '@ts-rest/core';

export type TransactionDetails = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['getTransaction'],
  200
>;

export interface UseTransactionOptions {
  accountId: TransactionDetails['accountId'];
  txnId: TransactionDetails['txnId'];
}

export function useTransaction({ accountId, txnId }: UseTransactionOptions) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery({
    queryKey: ['transaction', accountId, txnId],
    queryFn: async (): Promise<TransactionDetails> => {
      try {
        const response = await apiClient.banking.getTransaction({
          params: { accountId, txnId },
          overrideClientOptions: { credentials: 'include' },
        });

        if (response.status !== 200) {
          throw new Error('Failed to fetch transaction details');
        }

        return response.body;
      } catch (error) {
        if (handleAuthError(error)) {
          throw new Error('Authentication required');
        }
        throw error;
      }
    },
    enabled: !!accountId && !!txnId,
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}
