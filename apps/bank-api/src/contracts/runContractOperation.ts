import { ServerInferRequest } from '@ts-rest/core';
import {
  bankApiContract,
  getSupportedContractByTypeBlueId,
} from '@demo-bank-app/shared-bank-api-contract';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { runPayNoteDeliveryDecision } from '../paynote/runPayNoteDeliveryDecision';

export const runContractOperationHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['runContractOperation']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { sessionId, operation } = request.params;

  const {
    payNoteDeliveryRepository,
    contractRepository,
    myOsClient,
    logger,
    getOpenAiApiKey,
  } = await getDependencies();

  const { userId } = await extractAuthInfo(context.request);

  const contract = await contractRepository.getContractBySessionId(sessionId);

  if (!contract) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract not found',
    });
  }

  if (contract.userId !== userId) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract not found',
    });
  }

  const supportedContract = getSupportedContractByTypeBlueId(
    contract.typeBlueId
  );

  if (!supportedContract) {
    return problemResponse({
      status: 400,
      code: ERROR_CODES.UNSUPPORTED_CONTRACT_TYPE,
      message: 'Unsupported contract type',
    });
  }

  if (
    supportedContract.typeName === 'PayNote/PayNote Delivery' &&
    !['acceptPayNote', 'rejectPayNote'].includes(operation)
  ) {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Operation not allowed for PayNote delivery',
    });
  }

  const now = new Date().toISOString();

  if (supportedContract.typeName !== 'PayNote/PayNote Delivery') {
    const credentials = await myOsClient.getCredentials();
    const response = await myOsClient.runDocumentOperation({
      credentials,
      sessionId,
      operation,
      payload: request.body,
    });

    if (!response.ok) {
      return problemResponse({
        status: 500,
        code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
        message: 'Failed to run MyOS document operation',
        detail: response.body ? JSON.stringify(response.body) : undefined,
      });
    }

    await contractRepository.saveContract({
      ...contract,
      sessionId: contract.sessionId ?? sessionId,
    });

    return {
      status: 200 as const,
      body: {
        status: 'ok' as const,
        myosStatus: response.status,
        body: response.body,
      },
    };
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
    operation: operation as 'acceptPayNote' | 'rejectPayNote',
    requestBody: request.body,
    now,
    deps: {
      myOsClient,
      payNoteDeliveryRepository,
      contractRepository,
      logger,
      getOpenAiApiKey,
    },
    contract,
  });
};
