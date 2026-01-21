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
import {
  buildChannelBindingsFromContracts,
  ensureTimelineChannel,
} from '@demo-bank-app/paynotes';

const getContractsRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
};

const mergeUnique = (existing?: string[], incoming?: string[]) => {
  const set = new Set<string>(existing ?? []);
  (incoming ?? []).forEach(value => {
    if (value) {
      set.add(value);
    }
  });
  return set.size ? Array.from(set) : undefined;
};

export const runContractOperationHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['runContractOperation']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const {
    payNoteDeliveryRepository,
    contractRepository,
    myOsClient,
    holdRepository,
    logger,
  } = await getDependencies();

  const { userId } = await extractAuthInfo(context.request);
  const { sessionId, operation } = request.params;

  const contract = await contractRepository.getContractBySessionId(sessionId);

  if (!contract || contract.userId !== userId) {
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
      updatedAt: now,
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

  if (delivery.transactionIdentificationStatus !== 'identified') {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.PAYNOTE_DELIVERY_NOT_IDENTIFIED,
      message: 'PayNote delivery is not identified yet',
    });
  }

  const isAcceptance = operation === 'markPayNoteAcceptedByClient';
  const isRejection = operation === 'markPayNoteRejectedByClient';
  const isDecision = isAcceptance || isRejection;

  if (
    isDecision &&
    delivery.clientDecisionStatus &&
    delivery.clientDecisionStatus !== 'pending'
  ) {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.PAYNOTE_DELIVERY_DECISION_ALREADY_RECORDED,
      message: 'PayNote delivery decision has already been recorded',
    });
  }

  const basePayload =
    typeof request.body === 'object' && request.body !== null
      ? { ...(request.body as Record<string, unknown>) }
      : {};

  if (isAcceptance && !('acceptedAt' in basePayload)) {
    basePayload.acceptedAt = now;
  }
  if (isRejection && !('rejectedAt' in basePayload)) {
    basePayload.rejectedAt = now;
  }

  const credentials = await myOsClient.getCredentials();
  const response = await myOsClient.runDocumentOperation({
    credentials,
    sessionId,
    operation,
    payload: isDecision ? basePayload : request.body,
  });

  if (!response.ok) {
    return problemResponse({
      status: 500,
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      message: 'Failed to run MyOS document operation',
      detail: response.body ? JSON.stringify(response.body) : undefined,
    });
  }

  const updatedDelivery = {
    ...delivery,
    updatedAt: now,
  };

  if (isDecision) {
    updatedDelivery.clientDecisionStatus = isAcceptance
      ? 'accepted'
      : 'rejected';
    updatedDelivery.decisionRecordedAt = now;
  }

  if (isAcceptance) {
    if (delivery.holdId) {
      await holdRepository.disableHoldCapture(delivery.holdId);
    }

    const payNotePayload = delivery.deliveryDocument?.payNote as
      | Record<string, unknown>
      | undefined;

    if (payNotePayload) {
      try {
        const payNoteDocument = { ...payNotePayload };
        const payNoteContracts = {
          ...(getContractsRecord(payNotePayload.contracts) ?? {}),
        };
        const guarantorCheck = ensureTimelineChannel(
          payNoteContracts,
          'guarantorChannel',
          credentials.accountId
        );
        const payerCheck = ensureTimelineChannel(
          payNoteContracts,
          'payerChannel',
          credentials.accountId
        );

        if (!guarantorCheck.ok || !payerCheck.ok) {
          logger.warn('PayNote channel validation failed', {
            deliveryId: delivery.deliveryId,
            guarantorError: guarantorCheck.error,
            payerError: payerCheck.error,
          });
        } else {
          payNoteDocument.contracts = payNoteContracts;
          const channelBindings =
            buildChannelBindingsFromContracts(payNoteContracts);

          const bootstrapResponse = await myOsClient.bootstrapDocument({
            credentials,
            payload: {
              channelBindings,
              document: payNoteDocument,
            },
          });

          if (bootstrapResponse.ok) {
            const responseBody = bootstrapResponse.body as
              | { sessionId?: unknown }
              | undefined;
            const bootstrapSessionId =
              typeof responseBody?.sessionId === 'string'
                ? responseBody.sessionId
                : undefined;

            updatedDelivery.payNoteBootstrapRequestedAt = now;
            if (bootstrapSessionId) {
              updatedDelivery.payNoteBootstrapSessionId =
                updatedDelivery.payNoteBootstrapSessionId ?? bootstrapSessionId;
            }
          } else {
            logger.error('PayNote bootstrap failed after acceptance', {
              deliveryId: delivery.deliveryId,
              status: bootstrapResponse.status,
              body: bootstrapResponse.body,
            });
          }
        }
      } catch (error) {
        logger.error('Unable to bootstrap PayNote after acceptance', {
          deliveryId: delivery.deliveryId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      logger.warn('PayNote payload missing for accepted delivery', {
        deliveryId: delivery.deliveryId,
      });
    }
  }

  await payNoteDeliveryRepository.saveDelivery(updatedDelivery);

  const nextStatus =
    updatedDelivery.clientDecisionStatus ??
    updatedDelivery.transactionIdentificationStatus ??
    updatedDelivery.deliveryStatus;
  const statusTimestamps = {
    ...(updatedDelivery.deliveryUpdatedAt && {
      deliveryUpdatedAt: updatedDelivery.deliveryUpdatedAt,
    }),
    ...(updatedDelivery.identificationReportedAt && {
      identificationReportedAt: updatedDelivery.identificationReportedAt,
    }),
    ...(updatedDelivery.decisionRecordedAt && {
      decisionRecordedAt: updatedDelivery.decisionRecordedAt,
    }),
    ...(updatedDelivery.payNoteBootstrapRequestedAt && {
      payNoteBootstrapRequestedAt: updatedDelivery.payNoteBootstrapRequestedAt,
    }),
  };

  await contractRepository.saveContract({
    ...contract,
    sessionId: contract.sessionId ?? sessionId,
    documentId: updatedDelivery.deliveryDocumentId ?? contract.documentId,
    document: updatedDelivery.deliveryDocument ?? contract.document,
    status: nextStatus,
    statusUpdatedAt:
      nextStatus && nextStatus !== contract.status
        ? now
        : contract.statusUpdatedAt,
    statusTimestamps: {
      ...(contract.statusTimestamps ?? {}),
      ...statusTimestamps,
    },
    relatedTransactionIds: mergeUnique(
      contract.relatedTransactionIds,
      updatedDelivery.transactionId
        ? [updatedDelivery.transactionId]
        : undefined
    ),
    relatedHoldIds: mergeUnique(
      contract.relatedHoldIds,
      updatedDelivery.holdId ? [updatedDelivery.holdId] : undefined
    ),
    accountNumber: updatedDelivery.accountNumber ?? contract.accountNumber,
    userId: updatedDelivery.userId ?? contract.userId,
    updatedAt: now,
  });

  return {
    status: 200 as const,
    body: {
      status: 'ok' as const,
      myosStatus: response.status,
      body: response.body,
    },
  };
};
