import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import type { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { getDependencies } from './dependencies';
import { executeBootstrapPayNote } from './application/bootstrapPayNote';

export const bootstrapPayNoteHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['bootstrapPayNote']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const dependencies = await getDependencies();
  return executeBootstrapPayNote({ request, context, dependencies });
};
