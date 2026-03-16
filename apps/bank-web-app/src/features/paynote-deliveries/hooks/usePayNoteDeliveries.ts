import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { hydrateMerchantLogos } from '../../../lib/merchantDirectory';
import type { PayNoteDeliverySummary } from '../../../types/api';

type PayNoteDeliveryError = Error & { status?: number };

const makeError = (message: string, status?: number): PayNoteDeliveryError => {
  const error = new Error(message) as PayNoteDeliveryError;
  error.status = status;
  return error;
};

export function usePayNoteDeliveries() {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<PayNoteDeliverySummary[], PayNoteDeliveryError>({
    queryKey: ['paynote-deliveries'],
    queryFn: async (): Promise<PayNoteDeliverySummary[]> => {
      const response = await apiClient.banking.listPayNoteDeliveries({
        query: undefined,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to fetch PayNote deliveries', response.status);
      }

      return hydrateMerchantLogos(
        response.body.items,
        response.body.merchantDirectory
      );
    },
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
