import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import type { ContractOperationResponse } from '../../../types/api';

type RunContractOperationInput = {
  sessionId: string;
  operation: string;
  body?: unknown;
  deliveryId?: string;
};

type ContractOperationError = Error & { status?: number };

const makeError = (
  message: string,
  status?: number
): ContractOperationError => {
  const error = new Error(message) as ContractOperationError;
  error.status = status;
  return error;
};

export function useRunContractOperation() {
  const queryClient = useQueryClient();

  return useMutation<
    ContractOperationResponse,
    ContractOperationError,
    RunContractOperationInput
  >({
    mutationFn: async (
      input: RunContractOperationInput
    ): Promise<ContractOperationResponse> => {
      const response = await apiClient.banking.runContractOperation({
        params: {
          sessionId: input.sessionId,
          operation: input.operation,
        },
        body: input.body,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to run contract operation', response.status);
      }

      return response.body;
    },
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ['paynote-deliveries'] });
      if (variables.deliveryId) {
        queryClient.invalidateQueries({
          queryKey: ['paynote-delivery', variables.deliveryId],
        });
      }
    },
  });
}
