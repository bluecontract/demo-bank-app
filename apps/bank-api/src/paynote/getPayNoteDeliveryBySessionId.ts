import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from './dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { getPayNoteSummaryFromDocument } from '@demo-bank-app/paynotes';

export const getPayNoteDeliveryBySessionIdHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getPayNoteDeliveryBySessionId']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { payNoteDeliveryRepository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;

  logger.info('Fetching PayNote delivery by session', { userId, sessionId });

  const record = await payNoteDeliveryRepository.getDeliveryBySessionId(
    sessionId
  );
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

  if (!record.summary || !record.summaryUpdatedAt) {
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
      accountNumber: record.accountNumber,
      holdId: record.holdId,
      transactionId: record.transactionId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  };
};
