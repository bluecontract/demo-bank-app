import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';
import {
  buildMerchantDirectoryMap,
  resolveMerchantFrom,
} from '../shared/merchantDirectory';

export const listPayNoteDeliveriesHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listPayNoteDeliveries']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { logger, payNoteDeliveryRepository, merchantDirectoryRepository } =
    await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const clientDecisionStatus = request.query?.clientDecisionStatus;

  logger.debug('Listing PayNote deliveries', { userId, clientDecisionStatus });

  const deliveries = await payNoteDeliveryRepository.listDeliveriesByUserId(
    userId
  );

  const isProposalReady = (delivery: (typeof deliveries)[number]) => {
    const status = delivery.paymentMandateStatus;
    if (!status || status === 'not_required' || status === 'attached') {
      return true;
    }
    return false;
  };

  let visibleDeliveries = deliveries.filter(
    delivery =>
      delivery.transactionIdentificationStatus === 'identified' &&
      isProposalReady(delivery)
  );

  if (clientDecisionStatus) {
    visibleDeliveries = visibleDeliveries.filter(
      d => (d.clientDecisionStatus ?? 'pending') === clientDecisionStatus
    );
  }

  const directory = await buildMerchantDirectoryMap(
    visibleDeliveries.map(delivery => delivery.merchantId),
    merchantDirectoryRepository
  );

  return {
    status: 200 as const,
    body: {
      items: visibleDeliveries.map(delivery => ({
        ...delivery,
        from: resolveMerchantFrom(delivery.merchantId, directory),
      })),
    },
  };
};
