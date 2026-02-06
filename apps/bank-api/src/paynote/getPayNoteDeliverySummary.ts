import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { getDependencies } from './dependencies';
import { normalizeContractSummary } from '../contracts/summaryNormalization';

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

  const summaryPayload = record.summary;
  const summaryUpdatedAt = record.summaryUpdatedAt;
  const summarySourceUpdatedAt = record.summarySourceUpdatedAt;
  const summaryInputBlueId = record.summaryInputBlueId;
  const summaryModel = record.summaryModel;

  if (!summaryPayload || !summaryUpdatedAt) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND,
      message: 'PayNote proposal summary not available',
    });
  }

  const payNoteName =
    record.payNoteDocument && typeof record.payNoteDocument.name === 'string'
      ? record.payNoteDocument.name
      : null;

  const normalizedSummary = normalizeContractSummary(
    summaryPayload,
    payNoteName ?? 'PayNote proposal'
  );
  if (!normalizedSummary) {
    return problemResponse({
      status: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'PayNote proposal summary is invalid',
    });
  }

  return {
    status: 200 as const,
    body: {
      summary: normalizedSummary,
      summaryUpdatedAt,
      summarySourceUpdatedAt:
        summarySourceUpdatedAt ?? record.deliveryUpdatedAt ?? record.updatedAt,
      summaryInputBlueId,
      model: summaryModel,
    },
  };
};
