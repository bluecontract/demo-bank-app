import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { ClientInferResponseBody } from '@ts-rest/core';

export type ActivityDetail = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['getActivityDetail'],
  200
>;

export interface UseActivityDetailOptions {
  accountNumber: string | null;
  activityId: string | null;
  enabled?: boolean;
}

type ActivityDetailError = Error & { status?: number };

const makeError = (message: string, status?: number): ActivityDetailError => {
  const error = new Error(message) as ActivityDetailError;
  if (status) {
    error.status = status;
  }
  return error;
};

export function useActivityDetail({
  accountNumber,
  activityId,
  enabled = true,
}: UseActivityDetailOptions) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<ActivityDetail, ActivityDetailError>({
    queryKey: ['activity-detail', accountNumber, activityId],
    queryFn: async (): Promise<ActivityDetail> => {
      if (!accountNumber) {
        throw makeError('Account number is required');
      }

      if (!activityId) {
        throw makeError('Activity id is required');
      }

      try {
        const urlSafeActivityId = (() => {
          if (activityId.startsWith('TXN#')) {
            return activityId.replace('#', '--');
          }
          if (activityId.startsWith('HOLD#')) {
            return activityId.replace('#', '--');
          }
          return activityId;
        })();

        const encodedActivityId = encodeURIComponent(urlSafeActivityId);
        const response = await apiClient.banking.getActivityDetail({
          params: {
            accountNumber,
            activityId: encodedActivityId,
          },
          overrideClientOptions: { credentials: 'include' },
        });

        if (response.status !== 200) {
          const message =
            response.status === 404
              ? 'Activity detail not available yet'
              : 'Failed to fetch activity detail';
          throw makeError(message, response.status);
        }

        return response.body;
      } catch (error) {
        if (handleAuthError(error)) {
          throw makeError('Authentication required');
        }
        if (error instanceof Error) {
          throw error;
        }
        throw makeError('Failed to fetch activity detail');
      }
    },
    enabled: enabled && !!accountNumber && !!activityId,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000, // keep cached detail around after modal closes
    retry: (failureCount, error) => {
      const status = (error as ActivityDetailError)?.status;

      if (status === 404) {
        return failureCount < 5;
      }

      if (!status) {
        return failureCount < 2;
      }

      return false;
    },
    retryDelay: failureCount => Math.min(500 * failureCount, 2000),
  });
}
