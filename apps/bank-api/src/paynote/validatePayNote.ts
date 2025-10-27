import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import type { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { getDependencies } from './dependencies';
import { executeValidatePayNote } from './application/validatePayNote';

export const validatePayNoteHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['validatePayNote']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const dependencies = await getDependencies();
  return executeValidatePayNote({ request, context, dependencies });
};
