import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { hydrateMerchantLogos } from '../../../lib/merchantDirectory';
import type { PayNoteDeliverySummary } from '../../../types/api';

type ProposalsError = Error & { status?: number };

type UseProposalsOptions = {
  enabled?: boolean;
};

const makeError = (message: string, status?: number): ProposalsError => {
  const error = new Error(message) as ProposalsError;
  error.status = status;
  return error;
};

export function useProposals(options: UseProposalsOptions = {}) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<PayNoteDeliverySummary[], ProposalsError>({
    queryKey: ['proposals'],
    queryFn: async (): Promise<PayNoteDeliverySummary[]> => {
      const response = await apiClient.banking.listPayNoteDeliveries({
        query: undefined,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to fetch proposals', response.status);
      }

      return hydrateMerchantLogos(
        response.body.items,
        response.body.merchantDirectory
      );
    },
    enabled: options.enabled ?? true,
    refetchInterval: false,
    refetchOnMount: 'always',
    staleTime: 5 * 1000,
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
