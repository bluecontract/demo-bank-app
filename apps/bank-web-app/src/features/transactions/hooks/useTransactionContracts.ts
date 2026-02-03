import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import type { RelatedContractItem } from '../../../types/api';

type RelatedContractsError = Error & { status?: number };

const makeError = (message: string, status?: number): RelatedContractsError => {
  const error = new Error(message) as RelatedContractsError;
  if (status) {
    error.status = status;
  }
  return error;
};

export interface UseTransactionContractsOptions {
  transactionId: string | null;
  enabled?: boolean;
}

export function useTransactionContracts({
  transactionId,
  enabled = true,
}: UseTransactionContractsOptions) {
  const { handleAuthError } = useAuthErrorHandler();

  return useQuery<RelatedContractItem[], RelatedContractsError>({
    queryKey: ['transaction-contracts', transactionId],
    queryFn: async (): Promise<RelatedContractItem[]> => {
      if (!transactionId) {
        throw makeError('Transaction id is required');
      }

      try {
        const response = await apiClient.banking.listTransactionContracts({
          params: { txnId: transactionId },
          overrideClientOptions: { credentials: 'include' },
        });

        if (response.status !== 200) {
          const message =
            response.status === 401
              ? 'Authentication required'
              : 'Failed to fetch related contracts';
          throw makeError(message, response.status);
        }

        return response.body.items;
      } catch (error) {
        if (handleAuthError(error)) {
          throw makeError('Authentication required', 401);
        }
        if (error instanceof Error) {
          throw error;
        }
        throw makeError('Failed to fetch related contracts');
      }
    },
    enabled: enabled && !!transactionId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
