import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  applyMonitoringDecisionToContract,
  type ContractPendingActionStatus,
} from '@demo-bank-app/contracts';
import { runGuarantorUpdate } from '@demo-bank-app/paynotes';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';

const toEventWithRequestId = (input: {
  event: Record<string, unknown>;
  requestId?: string;
}): Record<string, unknown> => {
  if (!input.requestId) {
    return input.event;
  }
  return {
    ...input.event,
    inResponseTo: {
      requestId: input.requestId,
    },
  };
};

const mapDecision = (
  value: string
): Extract<ContractPendingActionStatus, 'accepted' | 'rejected'> | null => {
  if (value === 'accepted' || value === 'rejected') {
    return value;
  }
  return null;
};

export const decideContractPendingActionHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['decideContractPendingAction']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, myOsClient, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const { sessionId, actionId } = request.params;
  const decision = mapDecision(request.body.decision);

  if (!decision) {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Invalid pending action decision',
    });
  }

  const contract = await contractRepository.getContractBySessionId(sessionId);
  if (
    !contract ||
    contract.userId !== userId ||
    contract.sessionId !== sessionId
  ) {
    return problemResponse({
      status: 404,
      code: ERROR_CODES.CONTRACT_NOT_FOUND,
      message: 'Contract not found',
    });
  }

  const decidedAt = new Date().toISOString();
  const decisionResult = applyMonitoringDecisionToContract({
    contract,
    actionId,
    decision,
    decidedAt,
  });

  if (!decisionResult.ok) {
    return problemResponse({
      status: 409,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Pending action cannot be decided: ${decisionResult.reason}`,
    });
  }

  const { action, subscription } = decisionResult;
  const requestedEvents = subscription.requestedEvents ?? ['transaction'];
  const targetMerchantId = subscription.targetMerchantId;
  const startedAt = Date.now();

  const responseEvent = toEventWithRequestId({
    event:
      decision === 'accepted'
        ? {
            type: 'PayNote/Card Transaction Monitoring Started',
            targetMerchantId,
            events: requestedEvents,
            startedAt,
          }
        : {
            type: 'PayNote/Card Transaction Monitoring Request Rejected',
            reason: 'Monitoring rejected by user.',
          },
    requestId: action.requestId,
  });

  let credentials;
  try {
    credentials = await myOsClient.getCredentials();
  } catch (error) {
    logger.error(
      'Failed to resolve MyOS credentials for pending action decision',
      {
        sessionId,
        actionId,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return problemResponse({
      status: 500,
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      message: 'Failed to resolve MyOS credentials',
    });
  }

  const logs: Array<{
    level: 'info' | 'warn' | 'error';
    message: string;
    context?: Record<string, unknown>;
  }> = [];

  const emitted = await runGuarantorUpdate({
    myOsClient,
    credentials,
    sessionId,
    request: [responseEvent],
    logs,
    logContext: {
      sessionId,
      actionId,
      decision,
      targetMerchantId,
    },
    successMessage: `Reported monitoring decision (${decision}) via guarantorUpdate`,
    failureMessage: `Failed to report monitoring decision (${decision}) via guarantorUpdate`,
    missingCredentialsMessage:
      'Failed to report monitoring decision (missing credentials)',
  });

  if (!emitted) {
    const details = logs.find(entry => entry.level === 'error');
    return problemResponse({
      status: 500,
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      message: 'Failed to report monitoring decision',
      detail: details?.message,
    });
  }

  const updatedAt = new Date().toISOString();
  await contractRepository.saveContract({
    ...decisionResult.contract,
    updatedAt,
  });

  await contractRepository.addContractHistoryEntry({
    contractId: contract.contractId,
    kind: 'bankLifecycle',
    short:
      decision === 'accepted'
        ? 'Monitoring consent granted.'
        : 'Monitoring consent rejected.',
    more:
      decision === 'accepted'
        ? `Monitoring started for merchant ${targetMerchantId}.`
        : `Monitoring request rejected for merchant ${targetMerchantId}.`,
    createdAt: updatedAt,
  });

  return {
    status: 200 as const,
    body: {
      status: 'ok' as const,
      myosStatus: 200,
    },
  };
};
