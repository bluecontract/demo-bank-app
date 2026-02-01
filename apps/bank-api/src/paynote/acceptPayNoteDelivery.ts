import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import type { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { runContractOperationHandler } from '../contracts/runContractOperation';

export const acceptPayNoteDeliveryHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['acceptPayNoteDelivery']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { sessionId } = request.params;
  const now = new Date().toISOString();
  const body =
    typeof request.body === 'object' && request.body !== null
      ? { ...(request.body as Record<string, unknown>), acceptedAt: now }
      : { acceptedAt: now };

  return runContractOperationHandler(
    {
      params: { sessionId, operation: 'markPayNoteAcceptedByClient' },
      body,
    },
    context
  );
};
