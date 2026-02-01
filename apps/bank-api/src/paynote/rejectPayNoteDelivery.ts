import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import type { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { runContractOperationHandler } from '../contracts/runContractOperation';

export const rejectPayNoteDeliveryHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['rejectPayNoteDelivery']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { sessionId } = request.params;
  const now = new Date().toISOString();
  const { reason } = request.body ?? {};
  const body: Record<string, unknown> = { rejectedAt: now };
  if (reason !== undefined) {
    body.reason = reason;
  }

  return runContractOperationHandler(
    {
      params: { sessionId, operation: 'markPayNoteRejectedByClient' },
      body,
    },
    context
  );
};
