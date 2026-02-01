import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { PayNoteDeliveryDetailsSanitized } from '../../../types/api';

type ProposalDetailsError = Error & { status?: number };

const makeError = (message: string, status?: number): ProposalDetailsError => {
  const error = new Error(message) as ProposalDetailsError;
  error.status = status;
  return error;
};

export function useProposalDetails(sessionId: string | null) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<PayNoteDeliveryDetailsSanitized, ProposalDetailsError>({
    queryKey: ['proposal-details', sessionId ?? 'unknown'],
    queryFn: async (): Promise<PayNoteDeliveryDetailsSanitized> => {
      if (!sessionId) {
        throw makeError('Session id is required');
      }

      const response = await apiClient.banking.getPayNoteDeliveryBySessionId({
        params: { sessionId },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to fetch proposal details', response.status);
      }

      return response.body;
    },
    enabled: !!sessionId,
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error.status === 401 || error.status === 403) {
        return false;
      }
      return failureCount < 2;
    },
    throwOnError: error => {
      if (!handleAuthError(error)) {
        return true;
      }
      return false;
    },
  });
}
