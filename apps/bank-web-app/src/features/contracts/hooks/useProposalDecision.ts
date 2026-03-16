import { useCallback } from 'react';
import { useAcceptPayNoteDelivery } from './useAcceptPayNoteDelivery';
import { useRejectPayNoteDelivery } from './useRejectPayNoteDelivery';

type UseProposalDecisionOptions = {
  sessionId: string | null;
  onAccepted?: () => void;
  onRejected?: () => void;
  onError?: () => void;
};

export function useProposalDecision({
  sessionId,
  onAccepted,
  onRejected,
  onError,
}: UseProposalDecisionOptions) {
  const acceptMutation = useAcceptPayNoteDelivery();
  const rejectMutation = useRejectPayNoteDelivery();

  const isPending = acceptMutation.isPending || rejectMutation.isPending;

  const accept = useCallback(() => {
    if (!sessionId || isPending) {
      return;
    }
    acceptMutation.mutate(sessionId, {
      onSuccess: () => {
        onAccepted?.();
      },
      onError: () => {
        onError?.();
      },
    });
  }, [acceptMutation, isPending, onAccepted, onError, sessionId]);

  const reject = useCallback(() => {
    if (!sessionId || isPending) {
      return;
    }
    rejectMutation.mutate(
      { sessionId },
      {
        onSuccess: () => {
          onRejected?.();
        },
        onError: () => {
          onError?.();
        },
      }
    );
  }, [isPending, onError, onRejected, rejectMutation, sessionId]);

  return {
    accept,
    reject,
    isPending,
  };
}
