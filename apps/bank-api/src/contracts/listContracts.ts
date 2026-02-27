import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { filterCustomerVisibleContracts } from './contractVisibility';
import {
  buildMerchantDirectoryMap,
  resolveMerchantFrom,
} from '../shared/merchantDirectory';

export const listContractsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listContracts']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, logger, merchantDirectoryRepository } =
    await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const updatedSince = request.query?.updatedSince;

  logger.debug('Listing contracts', { userId, updatedSince });

  const items = await contractRepository.listContractsByUserId(userId, {
    updatedSince,
  });
  const visibleItems = filterCustomerVisibleContracts(items);
  const directory = await buildMerchantDirectoryMap(
    visibleItems.map(item => item.merchantId),
    merchantDirectoryRepository
  );

  return {
    status: 200 as const,
    body: {
      items: visibleItems.map(item => ({
        ...item,
        from: resolveMerchantFrom(item.merchantId, directory),
      })),
    },
  };
};
