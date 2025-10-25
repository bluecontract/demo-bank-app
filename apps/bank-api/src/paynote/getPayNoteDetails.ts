import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';

export const getPayNoteDetailsHandler = async (
  _request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getPayNoteDetails']
  >,
  _context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  // TODO: Implement PayNote detail retrieval (Iteration 3).
  return {
    status: 501 as const,
    body: { message: 'PayNote detail not implemented yet' },
  };
};
