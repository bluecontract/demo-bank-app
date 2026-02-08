import type { ContractRecord } from '@demo-bank-app/contracts';
import type { PayNoteDeliveryRecord } from '@demo-bank-app/paynotes';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import type { PaynoteDependencies } from './dependencies';
import { generatePayNoteDeliverySummaryForSessionId } from './generatePayNoteDeliverySummary';

type DecisionOperation = 'acceptPayNote' | 'rejectPayNote';

type DecisionDeps = Pick<
  PaynoteDependencies,
  | 'myOsClient'
  | 'payNoteDeliveryRepository'
  | 'contractRepository'
  | 'logger'
  | 'getOpenAiApiKey'
>;

const mergeUnique = (existing?: string[], incoming?: string[]) => {
  const set = new Set<string>(existing ?? []);
  (incoming ?? []).forEach(value => {
    if (value) {
      set.add(value);
    }
  });
  return set.size ? Array.from(set) : undefined;
};

export const runPayNoteDeliveryDecision = async (input: {
  delivery: PayNoteDeliveryRecord;
  sessionId: string;
  operation: DecisionOperation;
  requestBody: unknown;
  now: string;
  deps: DecisionDeps;
  contract?: ContractRecord | null;
}) => {
  const { delivery, sessionId, operation, requestBody, now, deps, contract } =
    input;
  if (contract && !contract.sessionId) {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'PayNote delivery contract is not ready yet',
    });
  }

  const operationSessionId =
    contract?.sessionId ??
    delivery.deliverySessionId ??
    (delivery.deliverySessionIds?.length
      ? delivery.deliverySessionIds[0]
      : undefined);
  const knownSessionIds = new Set<string>([
    ...(delivery.deliverySessionIds ?? []),
    ...(delivery.deliverySessionId ? [delivery.deliverySessionId] : []),
  ]);

  if (sessionId && knownSessionIds.size && !knownSessionIds.has(sessionId)) {
    deps.logger.warn('PayNote delivery decision session mismatch', {
      deliveryId: delivery.deliveryId,
      requestSessionId: sessionId,
      deliverySessionId: delivery.deliverySessionId,
      deliverySessionIds: delivery.deliverySessionIds,
    });
  }

  if (!operationSessionId) {
    deps.logger.error('PayNote delivery decision missing session id', {
      deliveryId: delivery.deliveryId,
    });
    return problemResponse({
      status: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'PayNote delivery session not available',
    });
  }

  if (delivery.transactionIdentificationStatus !== 'identified') {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.PAYNOTE_DELIVERY_NOT_IDENTIFIED,
      message: 'PayNote delivery is not identified yet',
    });
  }

  const isAcceptance = operation === 'acceptPayNote';
  const isRejection = operation === 'rejectPayNote';
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
    typeof requestBody === 'object' && requestBody !== null
      ? { ...(requestBody as Record<string, unknown>) }
      : {};

  if (isAcceptance && !('acceptedAt' in basePayload)) {
    basePayload.acceptedAt = now;
  }
  if (isRejection && !('rejectedAt' in basePayload)) {
    basePayload.rejectedAt = now;
  }

  const credentials = await deps.myOsClient.getCredentials();
  const response = await deps.myOsClient.runDocumentOperation({
    credentials,
    sessionId: operationSessionId,
    operation,
    payload: isDecision ? basePayload : requestBody,
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
    deps.logger.info('PayNote bootstrap deferred to webhook handler', {
      deliveryId: delivery.deliveryId,
      sessionId,
    });
  }

  await deps.payNoteDeliveryRepository.saveDelivery(updatedDelivery);

  if (isDecision && operationSessionId) {
    try {
      await generatePayNoteDeliverySummaryForSessionId({
        sessionId: operationSessionId,
        force: false,
        payNoteDeliveryRepository: deps.payNoteDeliveryRepository,
        getOpenAiApiKey: deps.getOpenAiApiKey,
        logger: deps.logger,
      });
    } catch (error) {
      deps.logger.warn('Failed to refresh PayNote proposal summary', {
        deliveryId: delivery.deliveryId,
        sessionId: operationSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (contract) {
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
        payNoteBootstrapRequestedAt:
          updatedDelivery.payNoteBootstrapRequestedAt,
      }),
    };

    await deps.contractRepository.saveContract({
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
    });
  }

  return {
    status: 200 as const,
    body: {
      status: 'ok' as const,
      myosStatus: response.status,
      body: response.body,
    },
  };
};
