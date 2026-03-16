import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { ClientInferRequest } from '@ts-rest/core';
import type { ContractOperationResponse } from '../../../types/api';

type PendingActionDecision = ClientInferRequest<
  (typeof bankApiContract)['banking']['decideContractPendingAction']
>['body'];

type DecideContractPendingActionInput = {
  sessionId: string;
  actionId: string;
  decision: PendingActionDecision;
};

type DecidePendingActionError = Error & { status?: number };

const makeError = (
  message: string,
  status?: number
): DecidePendingActionError => {
  const error = new Error(message) as DecidePendingActionError;
  if (status) {
    error.status = status;
  }
  return error;
};

export function useDecideContractPendingAction() {
  const queryClient = useQueryClient();

  return useMutation<
    ContractOperationResponse,
    DecidePendingActionError,
    DecideContractPendingActionInput
  >({
    mutationFn: async (
      input: DecideContractPendingActionInput
    ): Promise<ContractOperationResponse> => {
      const response = await apiClient.banking.decideContractPendingAction({
        params: {
          sessionId: input.sessionId,
          actionId: input.actionId,
        },
        body: input.decision,
        overrideClientOptions: { credentials: 'include' },
      });

      if (response.status !== 200) {
        throw makeError('Failed to decide pending action', response.status);
      }

      return response.body;
    },
    onSuccess: (_response, variables) => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({
        queryKey: ['contract-details', variables.sessionId],
      });
      queryClient.invalidateQueries({
        queryKey: ['contract-history', variables.sessionId],
      });
    },
  });
}
