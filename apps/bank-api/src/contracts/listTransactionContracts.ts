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

export const listTransactionContractsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listTransactionContracts']
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
  const { txnId } = request.params;

  logger.info('Listing contracts for transaction', {
    userId,
    transactionId: txnId,
  });

  const [contracts, deliveries] = await Promise.all([
    contractRepository.listContractsByTransactionId(txnId, { userId }),
    payNoteDeliveryRepository.listDeliveriesByUserId(userId),
  ]);

  const proposalItems = deliveries
    .filter(delivery => delivery.transactionId === txnId)
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
      items: [
        ...visibleContracts.map(item => ({
          ...item,
          from: resolveMerchantFrom(item.merchantId, directory),
        })),
        ...proposalItems.map(item => ({
          ...item,
          from: resolveMerchantFrom(item.merchantId, directory),
        })),
      ],
    },
  };
};
