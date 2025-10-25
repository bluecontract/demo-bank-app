import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';

export const getActivityDetailHandler = async (
  _request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getActivityDetail']
  >,
  _context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  // TODO: Implement activity detail lookup (Iteration 2).
  return {
    status: 501 as const,
    body: { message: 'Activity detail not implemented yet' },
  };
};
