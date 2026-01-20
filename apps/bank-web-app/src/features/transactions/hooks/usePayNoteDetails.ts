import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { ClientInferResponseBody } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';

export type PayNoteDetails = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['getPayNoteDetails'],
  200
>;

interface UsePayNoteDetailsOptions {
  accountNumber: string | null | undefined;
  payNoteDocumentId: string | null | undefined;
  enabled?: boolean;
}

type PayNoteDetailsError = Error & { status?: number };

const makeError = (message: string, status?: number): PayNoteDetailsError => {
  const error = new Error(message) as PayNoteDetailsError;
  if (status) {
    error.status = status;
  }
  return error;
};

export function usePayNoteDetails({
  accountNumber,
  payNoteDocumentId,
  enabled = true,
}: UsePayNoteDetailsOptions) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<PayNoteDetails, PayNoteDetailsError>({
    queryKey: ['paynote-details', accountNumber, payNoteDocumentId],
    queryFn: async (): Promise<PayNoteDetails> => {
      if (!accountNumber) {
        throw makeError('Account number is required');
      }

      if (!payNoteDocumentId) {
        throw makeError('PayNote document id is required');
      }

      try {
        const response = await apiClient.banking.getPayNoteDetails({
          params: {
            accountNumber,
            payNoteDocumentId,
          },
          overrideClientOptions: { credentials: 'include' },
        });

        if (response.status === 200) {
          return response.body;
        }

        if (response.status === 404) {
          throw makeError('PayNote details are not available yet.', 404);
        }

        if (response.status === 501) {
          throw makeError(
            'PayNote details are not available in this environment.',
            501
          );
        }

        throw makeError('Failed to fetch PayNote details', response.status);
      } catch (error) {
        if (handleAuthError(error)) {
          throw makeError('Authentication required');
        }

        if (error instanceof Error) {
          throw error;
        }

        throw makeError('Failed to fetch PayNote details');
      }
    },
    enabled: enabled && !!accountNumber && !!payNoteDocumentId,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: (failureCount, error) => {
      const status = (error as PayNoteDetailsError)?.status;

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
