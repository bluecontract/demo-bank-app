import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { filterCustomerVisibleContracts } from './contractVisibility';

export const listHoldContractsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listHoldContracts']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, payNoteDeliveryRepository, logger } =
    await getDependencies();
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

  return {
    status: 200 as const,
    body: {
      items: [...filterCustomerVisibleContracts(contracts), ...proposalItems],
    },
  };
};
