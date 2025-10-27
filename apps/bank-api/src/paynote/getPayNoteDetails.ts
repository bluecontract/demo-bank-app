import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import type { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { getDependencies } from './dependencies';
import { executeGetPayNoteDetails } from './application/getPayNoteDetails';

export const getPayNoteDetailsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getPayNoteDetails']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const dependencies = await getDependencies();
  return executeGetPayNoteDetails({ request, context, dependencies });
};
