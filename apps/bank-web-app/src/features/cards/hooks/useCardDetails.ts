import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { CardDetails } from '../../../types/api';

export function useCardDetails(cardId?: string | null) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery({
    queryKey: ['card', cardId ?? 'none'],
    queryFn: async (): Promise<CardDetails> => {
      if (!cardId) {
        throw new Error('Card id is required');
      }

      const response = await apiClient.banking.getCard({
        params: { cardId },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw new Error('Failed to fetch card details');
      }

      return response.body;
    },
    enabled: !!cardId,
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
