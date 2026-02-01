import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';

export const listPayNoteDeliveriesHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listPayNoteDeliveries']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { logger, payNoteDeliveryRepository } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const clientDecisionStatus = request.query?.clientDecisionStatus;

  logger.info('Listing PayNote deliveries', { userId, clientDecisionStatus });

  const deliveries = await payNoteDeliveryRepository.listDeliveriesByUserId(
    userId
  );

  let visibleDeliveries = deliveries.filter(
    delivery => delivery.transactionIdentificationStatus === 'identified'
  );

  if (clientDecisionStatus) {
    visibleDeliveries = visibleDeliveries.filter(
      d => (d.clientDecisionStatus ?? 'pending') === clientDecisionStatus
    );
  }

  return {
    status: 200 as const,
    body: {
      items: visibleDeliveries,
    },
  };
};
