import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { ClientInferResponseBody } from '@ts-rest/core';

export type ActivityData = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['listActivity'],
  200
>;

export type ActivityItem = ActivityData['items'][number];
export type PostedTransactionActivity = Extract<
  ActivityItem,
  { kind: 'POSTED_TRANSACTION' }
>;

export interface UseActivityOptions {
  accountNumber: string | null;
  limit?: number;
  cursor?: string;
}

export function useActivity({
  accountNumber,
  limit = 50,
  cursor,
}: UseActivityOptions) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery({
    queryKey: ['activity', accountNumber, limit, cursor],
    queryFn: async (): Promise<ActivityData> => {
      if (!accountNumber) {
        throw new Error('Account number is required');
      }

      try {
        const response = await apiClient.banking.listActivity({
          params: { accountNumber },
          query: { limit, cursor },
          overrideClientOptions: { credentials: 'include' },
        });

        if (response.status !== 200) {
          throw new Error('Failed to fetch account activity');
        }

        return response.body;
      } catch (error) {
        if (handleAuthError(error)) {
          // Auth error was handled, return empty data to avoid showing error state
          return { items: [], nextCursor: undefined };
        }
        throw error;
      }
    },
    enabled: !!accountNumber,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 2 * 60 * 1000, // 2 minutes
    placeholderData: accountNumber
      ? undefined
      : { items: [], nextCursor: undefined },
  });
}
