import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { bankApiContract } from '@demo-blue/shared-bank-api-contract';
import { ClientInferResponseBody } from '@ts-rest/core';

export type TransactionsData = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['listTransactions'],
  200
>;

export type Transaction = TransactionsData['items'][0];

export interface UseTransactionsOptions {
  accountId: string | null;
  limit?: number;
  cursor?: string;
}

export function useTransactions({
  accountId,
  limit = 50,
  cursor,
}: UseTransactionsOptions) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery({
    queryKey: ['transactions', accountId, limit, cursor],
    queryFn: async (): Promise<TransactionsData> => {
      if (!accountId) {
        throw new Error('Account ID is required');
      }

      try {
        const response = await apiClient.banking.listTransactions({
          params: { accountId },
          query: { limit, cursor },
          overrideClientOptions: { credentials: 'include' },
        });

        if (response.status !== 200) {
          throw new Error('Failed to fetch transactions');
        }

        return response.body;
      } catch (error) {
        if (handleAuthError(error)) {
          // Auth error was handled, return empty data to avoid showing error state
          return { items: [] };
        }
        throw error;
      }
    },
    enabled: !!accountId,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 2 * 60 * 1000, // 2 minutes
    placeholderData: accountId ? undefined : { items: [] },
  });
}
