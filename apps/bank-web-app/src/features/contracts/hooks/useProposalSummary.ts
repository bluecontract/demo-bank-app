import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { PayNoteDeliverySummaryFetch } from '../../../types/api';

type ProposalSummaryError = Error & { status?: number };

const makeError = (message: string, status?: number): ProposalSummaryError => {
  const error = new Error(message) as ProposalSummaryError;
  error.status = status;
  return error;
};

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_DURATION_MS = 60000;

export function useProposalSummary(sessionId: string | null, enabled = true) {
  const { handleAuthError } = useAuthErrorHandler();
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setTimedOut(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    setTimedOut(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      setTimedOut(true);
    }, MAX_POLL_DURATION_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, sessionId]);

  const query = useQuery<
    PayNoteDeliverySummaryFetch | null,
    ProposalSummaryError
  >({
    queryKey: ['proposal-summary', sessionId ?? 'unknown'],
    queryFn: async (): Promise<PayNoteDeliverySummaryFetch | null> => {
      if (!sessionId) {
        throw makeError('Session id is required');
      }

      const response = await apiClient.banking.getPayNoteDeliverySummary({
        params: { sessionId },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status === 404) {
        return null;
      }

      if (response.status !== 200) {
        throw makeError('Failed to load proposal summary', response.status);
      }

      return response.body;
    },
    enabled: Boolean(sessionId) && enabled && !timedOut,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: queryState => {
      if (timedOut) {
        return false;
      }
      const data = queryState.state.data as PayNoteDeliverySummaryFetch | null;
      return data ? false : POLL_INTERVAL_MS;
    },
    retry: (failureCount, error) => {
      if (error.status === 401 || error.status === 403) {
        return false;
      }
      return failureCount < 1;
    },
    throwOnError: error => {
      handleAuthError(error);
      return false;
    },
  });

  return { ...query, timedOut };
}
