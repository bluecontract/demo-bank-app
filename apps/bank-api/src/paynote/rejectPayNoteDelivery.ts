import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { runPayNoteDeliveryDecision } from './runPayNoteDeliveryDecision';

export const rejectPayNoteDeliveryHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['rejectPayNoteDelivery']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const {
    payNoteDeliveryRepository,
    myOsClient,
    holdRepository,
    contractRepository,
    logger,
    getOpenAiApiKey,
  } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;
  const now = new Date().toISOString();
  const { reason } = request.body ?? {};
  const body: Record<string, unknown> = { rejectedAt: now };
  if (reason !== undefined) {
    body.reason = reason;
  }

  const delivery = await payNoteDeliveryRepository.getDeliveryBySessionId(
    sessionId
  );

  if (!delivery || delivery.userId !== userId) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND,
      message: 'PayNote delivery not found',
    });
  }

  return runPayNoteDeliveryDecision({
    delivery,
    sessionId,
    operation: 'rejectPayNote',
    requestBody: body,
    now,
    deps: {
      myOsClient,
      holdRepository,
      payNoteDeliveryRepository,
      contractRepository,
      logger,
      getOpenAiApiKey,
    },
    contract: null,
  });
};
