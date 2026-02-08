import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import {
  applyOptimisticProposalDecision,
  rollbackOptimisticProposalDecision,
  type ProposalDecisionOptimisticSnapshot,
} from './proposalDecisionOptimistic';

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
    onMutate: async (
      sessionId: string
    ): Promise<ProposalDecisionOptimisticSnapshot> =>
      applyOptimisticProposalDecision(queryClient, sessionId, 'accepted'),
    onError: (_error, _sessionId, context) => {
      if (context) {
        rollbackOptimisticProposalDecision(queryClient, context);
      }
    },
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['paynote-deliveries'] });
      queryClient.invalidateQueries({
        queryKey: ['proposal-details', sessionId],
      });
    },
    throwOnError: error => {
      handleAuthError(error);
      return false;
    },
  });
}
