import { ServerInferRequest } from '@ts-rest/core';
import {
  bankApiContract,
  ContractDocumentSummaryDto,
} from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { getDependencies } from './dependencies';

export const getPayNoteDeliverySummaryHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getPayNoteDeliverySummary']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { payNoteDeliveryRepository } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;

  const record = await payNoteDeliveryRepository.getDeliveryBySessionId(
    sessionId
  );

  if (!record || record.userId !== userId) {
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
      message: 'PayNote proposal summary not available',
    });
  }

  const parsedSummary = ContractDocumentSummaryDto.safeParse(record.summary);
  if (!parsedSummary.success) {
    return problemResponse({
      status: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'PayNote proposal summary is invalid',
    });
  }

  return {
    status: 200 as const,
    body: {
      summary: parsedSummary.data,
      summaryUpdatedAt: record.summaryUpdatedAt,
      summarySourceUpdatedAt:
        record.summarySourceUpdatedAt ??
        record.deliveryUpdatedAt ??
        record.updatedAt,
      summaryInputBlueId: record.summaryInputBlueId,
      cached: true,
      model: record.summaryModel,
    },
  };
};
