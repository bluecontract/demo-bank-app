import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { useAuthErrorHandler } from '../../hooks/useAuthErrorHandler';

const POLL_INTERVAL_MS = 3000;

type UseUnifiedPollChangesOptions = {
  activityAccountNumber?: string | null;
};

type ActivityCursorState = {
  accountNumber?: string;
  cursor?: string;
};

export function useUnifiedPollChanges({
  activityAccountNumber = null,
}: UseUnifiedPollChangesOptions = {}) {
  const queryClient = useQueryClient();
  const { handleAuthError } = useAuthErrorHandler();
  const inFlightRef = useRef(false);
  const contractsCursorRef = useRef<string | undefined>(undefined);
  const proposalsCursorRef = useRef<string | undefined>(undefined);
  const activityCursorRef = useRef<ActivityCursorState>({});

  const pollChanges = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }

    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;

    const includeActivity = Boolean(activityAccountNumber);
    const activityCursor =
      includeActivity &&
      activityCursorRef.current.accountNumber === activityAccountNumber
        ? activityCursorRef.current.cursor
        : undefined;
    const shouldForceActivityRefresh = includeActivity && !activityCursor;

    try {
      const response = await apiClient.banking.pollChanges({
        query: {
          includeContracts: true,
          includeProposals: true,
          includeActivity,
          activityAccountNumber: activityAccountNumber ?? undefined,
          contractsCursor: contractsCursorRef.current,
          proposalsCursor: proposalsCursorRef.current,
          activityCursor,
        },
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        handleAuthError({ status: response.status });
        return;
      }

      if (response.body.contracts?.cursor) {
        contractsCursorRef.current = response.body.contracts.cursor;
      }
      if (response.body.proposals?.cursor) {
        proposalsCursorRef.current = response.body.proposals.cursor;
      }

      if (response.body.contracts?.changed) {
        void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      }
      if (response.body.proposals?.changed) {
        void queryClient.invalidateQueries({ queryKey: ['proposals'] });
      }

      if (!includeActivity) {
        activityCursorRef.current = {};
      } else if (response.body.activity?.cursor) {
        activityCursorRef.current = {
          accountNumber: activityAccountNumber ?? undefined,
          cursor: response.body.activity.cursor,
        };
      }

      if (
        includeActivity &&
        activityAccountNumber &&
        (response.body.activity?.changed || shouldForceActivityRefresh)
      ) {
        void queryClient.invalidateQueries({
          queryKey: ['activity', activityAccountNumber],
        });
      }
    } catch (error) {
      handleAuthError(error);
    } finally {
      inFlightRef.current = false;
    }
  }, [activityAccountNumber, handleAuthError, queryClient]);

  useEffect(() => {
    if (__UI_REFRESH_DISABLE_POLLING__ === 'true') {
      return;
    }

    void pollChanges();
    const interval = setInterval(() => {
      void pollChanges();
    }, POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void pollChanges();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pollChanges]);
}
