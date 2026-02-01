import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';

type AcceptPayNoteDeliveryError = Error & { status?: number };

const makeError = (
  message: string,
  status?: number
): AcceptPayNoteDeliveryError => {
  const error = new Error(message) as AcceptPayNoteDeliveryError;
  error.status = status;
  return error;
};

export function useAcceptPayNoteDelivery() {
  const queryClient = useQueryClient();
  const { handleAuthError } = useAuthErrorHandler();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await apiClient.banking.acceptPayNoteDelivery({
        params: { sessionId },
        body: undefined,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError(
          response.body &&
            typeof response.body === 'object' &&
            'message' in response.body
            ? String((response.body as { message?: unknown }).message)
            : 'Failed to accept proposal',
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
      if (!handleAuthError(error)) {
        return true;
      }
      return false;
    },
  });
}
