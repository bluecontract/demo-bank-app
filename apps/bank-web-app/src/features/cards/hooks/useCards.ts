import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { CardSummary } from '../../../types/api';

export interface UseCardsOptions {
  accountId?: string | null;
}

export function useCards({ accountId }: UseCardsOptions) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery({
    queryKey: ['cards', accountId ?? 'all'],
    queryFn: async (): Promise<CardSummary[]> => {
      if (!accountId) {
        throw new Error('Account id is required');
      }

      const response = await apiClient.banking.listCards({
        query: { accountId },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw new Error('Failed to fetch cards');
      }

      return response.body.cards;
    },
    enabled: !!accountId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    throwOnError: error => {
      if (!handleAuthError(error)) {
        return true;
      }
      return false;
    },
  });
}
