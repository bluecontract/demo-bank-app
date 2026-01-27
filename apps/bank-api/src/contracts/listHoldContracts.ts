import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';

export const listHoldContractsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listHoldContracts']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { holdId } = request.params;

  logger.info('Listing contracts for hold', { userId, holdId });

  const items = await contractRepository.listContractsByHoldId(holdId, {
    userId,
  });

  return {
    status: 200 as const,
    body: {
      items,
    },
  };
};
