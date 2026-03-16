import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { getPayNoteSummaryFromDocument } from '@demo-bank-app/paynotes';
import {
  buildMerchantDirectoryMap,
  resolveMerchantFrom,
} from '../shared/merchantDirectory';

export const getPayNoteDeliveryHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getPayNoteDelivery']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { payNoteDeliveryRepository, logger, merchantDirectoryRepository } =
    await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { deliveryId } = request.params;

  logger.info('Fetching PayNote delivery', { userId, deliveryId });

  const record = await payNoteDeliveryRepository.getDelivery(deliveryId);
  if (
    !record ||
    record.userId !== userId ||
    record.transactionIdentificationStatus !== 'identified'
  ) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND,
      message: 'PayNote delivery not found',
    });
  }

  const payNoteSummary = record.deliveryDocument
    ? getPayNoteSummaryFromDocument(
        (
          record.deliveryDocument.payNoteBootstrapRequest as
            | { document?: Record<string, unknown> }
            | undefined
        )?.document
      )
    : {};

  const directory = await buildMerchantDirectoryMap(
    [record.merchantId],
    merchantDirectoryRepository
  );
  const from = resolveMerchantFrom(record.merchantId, directory);

  return {
    status: 200 as const,
    body: {
      deliveryId: record.deliveryId,
      deliverySessionId: record.deliverySessionId,
      deliveryStatus: record.deliveryStatus,
      transactionIdentificationStatus: record.transactionIdentificationStatus,
      clientDecisionStatus: record.clientDecisionStatus,
      cardTransactionDetails: record.cardTransactionDetails,
      payNote: payNoteSummary,
      deliveryDocument: record.deliveryDocument,
      payNoteDocument: record.payNoteDocument,
      from,
      accountNumber: record.accountNumber,
      holdId: record.holdId,
      transactionId: record.transactionId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  };
};
