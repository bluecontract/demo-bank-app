import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { filterCustomerVisibleContracts } from './contractVisibility';
import {
  buildMerchantDirectoryResponse,
  buildMerchantDirectoryMap,
  resolveMerchantFrom,
} from '../shared/merchantDirectory';

export const listHoldContractsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listHoldContracts']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const {
    contractRepository,
    payNoteDeliveryRepository,
    merchantDirectoryRepository,
    logger,
  } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { holdId } = request.params;

  logger.info('Listing contracts for hold', { userId, holdId });

  const [contracts, deliveries] = await Promise.all([
    contractRepository.listContractsByHoldId(holdId, { userId }),
    payNoteDeliveryRepository.listDeliveriesByUserId(userId),
  ]);

  const proposalItems = deliveries
    .filter(delivery => delivery.holdId === holdId)
    .map(delivery => ({
      ...delivery,
      kind: 'proposal' as const,
    }));

  const visibleContracts = filterCustomerVisibleContracts(contracts);
  const directory = await buildMerchantDirectoryMap(
    [
      ...visibleContracts.map(item => item.merchantId),
      ...proposalItems.map(item => item.merchantId),
    ],
    merchantDirectoryRepository
  );

  return {
    status: 200 as const,
    body: {
      merchantDirectory: buildMerchantDirectoryResponse(directory),
      items: [
        ...visibleContracts.map(item => ({
          ...item,
          from: resolveMerchantFrom(item.merchantId, directory, {
            includeLogo: false,
          }),
        })),
        ...proposalItems.map(item => ({
          ...item,
          from: resolveMerchantFrom(item.merchantId, directory, {
            includeLogo: false,
          }),
        })),
      ],
    },
  };
};
