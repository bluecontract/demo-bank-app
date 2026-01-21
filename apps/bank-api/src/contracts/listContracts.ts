import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';

export const listContractsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listContracts']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const updatedSince = request.query?.updatedSince;

  logger.info('Listing contracts', { userId, updatedSince });

  const items = await contractRepository.listContractsByUserId(userId, {
    updatedSince,
  });

  return {
    status: 200 as const,
    body: {
      items,
    },
  };
};
