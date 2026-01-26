import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { PayNoteDeliveryDetails } from '../../../types/api';

type PayNoteDeliveryError = Error & { status?: number };

interface UsePayNoteDeliveryDetailsOptions {
  deliveryId: string | null;
  enabled?: boolean;
}

const makeError = (message: string, status?: number): PayNoteDeliveryError => {
  const error = new Error(message) as PayNoteDeliveryError;
  error.status = status;
  return error;
};

export function usePayNoteDeliveryDetails({
  deliveryId,
  enabled = true,
}: UsePayNoteDeliveryDetailsOptions) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<PayNoteDeliveryDetails, PayNoteDeliveryError>({
    queryKey: ['paynote-delivery', deliveryId],
    queryFn: async (): Promise<PayNoteDeliveryDetails> => {
      if (!deliveryId) {
        throw makeError('PayNote delivery id is required');
      }

      const response = await apiClient.banking.getPayNoteDelivery({
        params: { deliveryId },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status === 200) {
        return response.body;
      }

      throw makeError(
        'Failed to fetch PayNote delivery details',
        response.status
      );
    },
    enabled: enabled && !!deliveryId,
    throwOnError: error => {
      if (!handleAuthError(error)) {
        return true;
      }
      return false;
    },
  });
}
