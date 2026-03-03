import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { runPayNoteDeliveryDecision } from './runPayNoteDeliveryDecision';

export const acceptPayNoteDeliveryHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['acceptPayNoteDelivery']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const {
    payNoteDeliveryRepository,
    myOsClient,
    contractRepository,
    merchantDirectoryRepository,
    logger,
    getOpenAiApiKey,
  } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId } = request.params;
  const now = new Date().toISOString();
  const body =
    typeof request.body === 'object' && request.body !== null
      ? { ...(request.body as Record<string, unknown>), acceptedAt: now }
      : { acceptedAt: now };

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

  const deliveryDocumentId = delivery.deliveryDocumentId;
  if (!deliveryDocumentId) {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'PayNote delivery contract is not ready yet',
    });
  }

  const contract = await contractRepository.getContractByDocumentId(
    deliveryDocumentId
  );
  if (!contract?.sessionId) {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'PayNote delivery contract is not ready yet',
    });
  }

  if (contract.sessionId !== sessionId) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.PAYNOTE_DELIVERY_NOT_FOUND,
      message: 'PayNote delivery not found',
    });
  }

  return runPayNoteDeliveryDecision({
    delivery,
    sessionId,
    operation: 'acceptPayNote',
    requestBody: body,
    now,
    deps: {
      myOsClient,
      payNoteDeliveryRepository,
      merchantDirectoryRepository,
      contractRepository,
      logger,
      getOpenAiApiKey,
    },
    contract,
  });
};
