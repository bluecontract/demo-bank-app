import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useAuthErrorHandler } from '../../../hooks/useAuthErrorHandler';
import { hydrateMerchantLogos } from '../../../lib/merchantDirectory';
import type { RelatedContractItem } from '../../../types/api';

type RelatedContractsError = Error & { status?: number };

const makeError = (message: string, status?: number): RelatedContractsError => {
  const error = new Error(message) as RelatedContractsError;
  if (status) {
    error.status = status;
  }
  return error;
};

export interface UseRelatedContractsOptions {
  transactionIds?: string[] | null;
  holdIds?: string[] | null;
  enabled?: boolean;
}

const normalizeIds = (ids: string[] | null | undefined) => {
  if (!ids) {
    return [];
  }
  return Array.from(new Set(ids.filter(Boolean)));
};

export function useRelatedContracts({
  transactionIds,
  holdIds,
  enabled = true,
}: UseRelatedContractsOptions) {
  const { handleAuthError } = useAuthErrorHandler();
  const normalizedTransactionIds = useMemo(
    () => normalizeIds(transactionIds),
    [transactionIds]
  );
  const normalizedHoldIds = useMemo(() => normalizeIds(holdIds), [holdIds]);

  const hasIds =
    normalizedTransactionIds.length > 0 || normalizedHoldIds.length > 0;

  return useQuery<RelatedContractItem[], RelatedContractsError>({
    queryKey: [
      'related-contracts',
      normalizedTransactionIds,
      normalizedHoldIds,
    ],
    queryFn: async (): Promise<RelatedContractItem[]> => {
      if (!hasIds) {
        return [];
      }

      try {
        const responses = await Promise.all([
          ...normalizedTransactionIds.map(transactionId =>
            apiClient.banking.listTransactionContracts({
              params: { txnId: transactionId },
              overrideClientOptions: { credentials: 'include' },
            })
          ),
          ...normalizedHoldIds.map(holdId =>
            apiClient.banking.listHoldContracts({
              params: { holdId },
              overrideClientOptions: { credentials: 'include' },
            })
          ),
        ]);

        const items: RelatedContractItem[] = [];

        responses.forEach(response => {
          if (response.status !== 200) {
            const message =
              response.status === 401
                ? 'Authentication required'
                : 'Failed to fetch related contracts';
            throw makeError(message, response.status);
          }
          items.push(
            ...hydrateMerchantLogos(
              response.body.items,
              response.body.merchantDirectory
            )
          );
        });

        return items;
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
    enabled: enabled && hasIds,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}
