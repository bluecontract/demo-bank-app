import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';

export const listPayNoteDeliveriesHandler = async (
  _request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listPayNoteDeliveries']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { logger, payNoteDeliveryRepository } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);

  logger.info('Listing PayNote deliveries', { userId });

  const deliveries = await payNoteDeliveryRepository.listDeliveriesByUserId(
    userId
  );

  const visibleDeliveries = deliveries.filter(
    delivery => delivery.transactionIdentificationStatus === 'identified'
  );

  return {
    status: 200 as const,
    body: {
      items: visibleDeliveries,
    },
  };
};
