import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';

type RejectPayNoteDeliveryError = Error & { status?: number };

const makeError = (
  message: string,
  status?: number
): RejectPayNoteDeliveryError => {
  const error = new Error(message) as RejectPayNoteDeliveryError;
  error.status = status;
  return error;
};

export function useRejectPayNoteDelivery() {
  const queryClient = useQueryClient();
  const { handleAuthError } = useAuthErrorHandler();

  return useMutation({
    mutationFn: async (input: { sessionId: string; reason?: string }) => {
      const response = await apiClient.banking.rejectPayNoteDelivery({
        params: { sessionId: input.sessionId },
        body: input.reason !== undefined ? { reason: input.reason } : undefined,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError(
          response.body &&
            typeof response.body === 'object' &&
            'message' in response.body
            ? String((response.body as { message?: unknown }).message)
            : 'Failed to reject proposal',
          response.status
        );
      }

      return response.body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['paynote-deliveries'] });
    },
    throwOnError: error => {
      handleAuthError(error);
      return false;
    },
  });
}
