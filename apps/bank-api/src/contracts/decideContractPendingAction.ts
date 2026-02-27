import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  applyMonitoringDecisionToContract,
  type ContractPendingAction,
  type ContractPendingActionStatus,
  type ContractRecord,
} from '@demo-bank-app/contracts';
import { runGuarantorUpdate } from '@demo-bank-app/paynotes';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';

const PAYMENT_MANDATE_BOOTSTRAP_PENDING_ACTION_TYPE =
  'paymentMandateBootstrapApproval';

type PendingActionDecision = Extract<
  ContractPendingActionStatus,
  'accepted' | 'rejected'
>;

type PaymentMandateBootstrapPayload = {
  requestId?: string;
  channelBindings?: Record<string, { accountId?: string; email?: string }>;
  paymentMandateDocument: Record<string, unknown>;
};

type MonitoringDecisionOutcome = {
  kind: 'monitoring';
  contract: ContractRecord;
  responseEvents: Record<string, unknown>[];
  targetMerchantId: string;
  requestId?: string;
  historyShort: string;
  historyMore: string;
};

type PaymentMandateBootstrapDecisionOutcome = {
  kind: 'payment-mandate-bootstrap';
  contract: ContractRecord;
  responseEvents: Record<string, unknown>[];
  requestId?: string;
  paymentMandateBootstrapSessionId?: string;
  historyShort: string;
  historyMore: string;
};

type DecisionOutcome =
  | MonitoringDecisionOutcome
  | PaymentMandateBootstrapDecisionOutcome;

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

const mapDecision = (value: string): PendingActionDecision | null => {
  if (value === 'accepted' || value === 'rejected') {
    return value;
  }
  return null;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const resolveOperationFailureReason = (input: {
  status: number;
  body?: unknown;
  fallbackPrefix: string;
}): string => {
  const bodyRecord = toRecord(input.body);
  const detail =
    getString(bodyRecord?.detail) ??
    getString(bodyRecord?.message) ??
    getString(bodyRecord?.error);
  return detail
    ? `${input.fallbackPrefix}: ${detail}`
    : `${input.fallbackPrefix} with status ${input.status}.`;
};

const normalizeChannelBindings = (
  value: unknown
): Record<string, { accountId?: string; email?: string }> | undefined => {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }

  const bindings = Object.entries(record).reduce<
    Record<string, { accountId?: string; email?: string }>
  >((acc, [key, item]) => {
    const itemRecord = toRecord(item);
    if (!itemRecord) {
      return acc;
    }
    const accountId = getString(itemRecord.accountId);
    const email = getString(itemRecord.email);
    if (!accountId && !email) {
      return acc;
    }
    acc[key] = {
      ...(accountId ? { accountId } : {}),
      ...(email ? { email } : {}),
    };
    return acc;
  }, {});

  return Object.keys(bindings).length > 0 ? bindings : undefined;
};

const parsePaymentMandateBootstrapPayload = (
  action: ContractPendingAction
): PaymentMandateBootstrapPayload | null => {
  const payload = toRecord(action.payload);
  if (!payload) {
    return null;
  }

  const paymentMandateDocument =
    toRecord(payload.paymentMandateDocument) ?? toRecord(payload.document);
  if (!paymentMandateDocument) {
    return null;
  }

  return {
    requestId: getString(payload.requestId) ?? action.requestId,
    channelBindings: normalizeChannelBindings(payload.channelBindings),
    paymentMandateDocument,
  };
};

const ensurePaymentMandateGuarantorBootstrapInput = (input: {
  paymentMandateDocument: Record<string, unknown>;
  channelBindings?: Record<string, { accountId?: string; email?: string }>;
  guarantorAccountId: string;
}): {
  paymentMandateDocument: Record<string, unknown>;
  channelBindings: Record<string, { accountId?: string; email?: string }>;
} => {
  const contracts = toRecord(input.paymentMandateDocument.contracts) ?? {};
  const guarantorContract = toRecord(contracts.guarantorChannel) ?? {};

  const paymentMandateDocument: Record<string, unknown> = {
    ...input.paymentMandateDocument,
    contracts: {
      ...contracts,
      guarantorChannel: {
        ...guarantorContract,
        type: getString(guarantorContract.type) ?? 'MyOS/MyOS Timeline Channel',
      },
    },
  };

  const channelBindings = {
    ...(input.channelBindings ?? {}),
    guarantorChannel: { accountId: input.guarantorAccountId },
  };

  return {
    paymentMandateDocument,
    channelBindings,
  };
};

const readText = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  const record = toRecord(value);
  const wrappedValue = record?.value;
  if (typeof wrappedValue === 'string' && wrappedValue.trim().length > 0) {
    return wrappedValue.trim();
  }
  return undefined;
};

const materializePaymentMandateIdentityFromContract = (input: {
  contract: ContractRecord;
  paymentMandateDocument: Record<string, unknown>;
}):
  | { ok: true; paymentMandateDocument: Record<string, unknown> }
  | { ok: false; reason: string } => {
  const { contract } = input;
  const paymentMandateDocument = { ...input.paymentMandateDocument };

  const granterType = readText(paymentMandateDocument.granterType);
  if (granterType === 'customer') {
    const customerId = getString(contract.userId);
    if (!customerId) {
      return {
        ok: false,
        reason: 'Unable to resolve customer granter from contract context.',
      };
    }
    paymentMandateDocument.granterId = customerId;
  } else if (granterType === 'merchant') {
    const merchantId = getString(contract.merchantId);
    if (!merchantId) {
      return {
        ok: false,
        reason: 'Unable to resolve merchant granter from contract context.',
      };
    }
    paymentMandateDocument.granterId = merchantId;
  }

  const granteeType = readText(paymentMandateDocument.granteeType);
  if (granteeType === 'customerId') {
    const customerId = getString(contract.userId);
    if (!customerId) {
      return {
        ok: false,
        reason: 'Unable to resolve customer grantee from contract context.',
      };
    }
    paymentMandateDocument.granteeId = customerId;
  } else if (granteeType === 'merchantId') {
    const merchantId = getString(contract.merchantId);
    if (!merchantId) {
      return {
        ok: false,
        reason: 'Unable to resolve merchant grantee from contract context.',
      };
    }
    paymentMandateDocument.granteeId = merchantId;
  } else if (granteeType === 'documentId') {
    const documentId = getString(contract.documentId);
    if (!documentId) {
      return {
        ok: false,
        reason: 'Unable to resolve document grantee from contract context.',
      };
    }
    paymentMandateDocument.granteeId = documentId;
  }

  return {
    ok: true,
    paymentMandateDocument,
  };
};

const applyPaymentMandateBootstrapDecisionToContract = (input: {
  contract: ContractRecord;
  actionId: string;
  decision: PendingActionDecision;
  decidedAt: string;
  paymentMandateDocumentId?: string;
  paymentMandateSessionId?: string;
}):
  | { ok: true; contract: ContractRecord; action: ContractPendingAction }
  | {
      ok: false;
      reason: 'action-not-found' | 'action-not-pending' | 'unsupported-action';
    } => {
  const {
    contract,
    actionId,
    decision,
    decidedAt,
    paymentMandateDocumentId,
    paymentMandateSessionId,
  } = input;

  const action = (contract.pendingActions ?? []).find(
    item => item.actionId === actionId
  );
  if (!action) {
    return { ok: false, reason: 'action-not-found' };
  }
  if (action.type !== PAYMENT_MANDATE_BOOTSTRAP_PENDING_ACTION_TYPE) {
    return { ok: false, reason: 'unsupported-action' };
  }
  if (action.status !== 'pending') {
    return { ok: false, reason: 'action-not-pending' };
  }

  const nextPayload = {
    ...(toRecord(action.payload) ?? {}),
    ...(paymentMandateDocumentId
      ? {
          paymentMandateDocumentId,
        }
      : {}),
    ...(paymentMandateSessionId
      ? {
          paymentMandateSessionId,
        }
      : {}),
  };

  const nextAction: ContractPendingAction = {
    ...action,
    status: decision,
    decidedAt,
    payload: nextPayload,
  };

  const nextActions = (contract.pendingActions ?? []).map(item =>
    item.actionId === actionId ? nextAction : item
  );

  return {
    ok: true,
    contract: {
      ...contract,
      pendingActions: nextActions,
    },
    action: nextAction,
  };
};

const resolveDecisionOutcome = async (input: {
  contract: ContractRecord;
  actionId: string;
  decision: PendingActionDecision;
  decidedAt: string;
  myOsClient: Awaited<ReturnType<typeof getDependencies>>['myOsClient'];
  credentials: Awaited<
    ReturnType<
      Awaited<
        ReturnType<typeof getDependencies>
      >['myOsClient']['getCredentials']
    >
  >;
}): Promise<
  | {
      ok: true;
      outcome: DecisionOutcome;
    }
  | {
      ok: false;
      status: 409 | 500;
      message: string;
      detail?: string;
    }
> => {
  const action = (input.contract.pendingActions ?? []).find(
    item => item.actionId === input.actionId
  );
  if (!action) {
    return {
      ok: false,
      status: 409,
      message: 'Pending action cannot be decided: action-not-found',
    };
  }

  if (action.type === 'monitoringConsentApproval') {
    const decisionResult = applyMonitoringDecisionToContract({
      contract: input.contract,
      actionId: input.actionId,
      decision: input.decision,
      decidedAt: input.decidedAt,
    });

    if (!decisionResult.ok) {
      return {
        ok: false,
        status: 409,
        message: `Pending action cannot be decided: ${decisionResult.reason}`,
      };
    }

    const { action: resolvedAction, subscription } = decisionResult;
    const requestedEvents = subscription.requestedEvents ?? ['transaction'];
    const targetMerchantId = subscription.targetMerchantId;
    const startedAt = Date.now();

    const responseEvent = toEventWithRequestId({
      event:
        input.decision === 'accepted'
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
      requestId: resolvedAction.requestId,
    });

    return {
      ok: true,
      outcome: {
        kind: 'monitoring',
        contract: decisionResult.contract,
        requestId: resolvedAction.requestId,
        targetMerchantId,
        responseEvents: [responseEvent],
        historyShort:
          input.decision === 'accepted'
            ? 'Monitoring consent granted.'
            : 'Monitoring consent rejected.',
        historyMore:
          input.decision === 'accepted'
            ? `Monitoring started for merchant ${targetMerchantId}.`
            : `Monitoring request rejected for merchant ${targetMerchantId}.`,
      },
    };
  }

  if (action.type === PAYMENT_MANDATE_BOOTSTRAP_PENDING_ACTION_TYPE) {
    const payload = parsePaymentMandateBootstrapPayload(action);
    if (!payload) {
      return {
        ok: false,
        status: 409,
        message:
          'Pending action cannot be decided: invalid payment mandate bootstrap payload',
      };
    }

    let paymentMandateDocumentId: string | undefined;
    let paymentMandateSessionId: string | undefined;
    if (input.decision === 'accepted') {
      const mandateIdentityMaterialization =
        materializePaymentMandateIdentityFromContract({
          contract: input.contract,
          paymentMandateDocument: payload.paymentMandateDocument,
        });
      if (!mandateIdentityMaterialization.ok) {
        return {
          ok: false,
          status: 409,
          message: 'Pending action cannot be decided: invalid mandate context',
          detail: mandateIdentityMaterialization.reason,
        };
      }

      const mandateBootstrapPayload =
        ensurePaymentMandateGuarantorBootstrapInput({
          paymentMandateDocument:
            mandateIdentityMaterialization.paymentMandateDocument,
          channelBindings: payload.channelBindings,
          guarantorAccountId: input.credentials.accountId,
        });

      const bootstrapResponse = await input.myOsClient.bootstrapDocument({
        credentials: input.credentials,
        payload: {
          channelBindings: mandateBootstrapPayload.channelBindings,
          document: mandateBootstrapPayload.paymentMandateDocument,
        },
      });
      if (!bootstrapResponse.ok) {
        return {
          ok: false,
          status: 500,
          message: 'Failed to bootstrap payment mandate document',
          detail: resolveOperationFailureReason({
            status: bootstrapResponse.status,
            body: bootstrapResponse.body,
            fallbackPrefix: 'Payment mandate bootstrap failed',
          }),
        };
      }

      paymentMandateSessionId = getString(
        toRecord(bootstrapResponse.body)?.sessionId
      );
    }

    const decisionResult = applyPaymentMandateBootstrapDecisionToContract({
      contract: input.contract,
      actionId: input.actionId,
      decision: input.decision,
      decidedAt: input.decidedAt,
      paymentMandateDocumentId,
      paymentMandateSessionId,
    });
    if (!decisionResult.ok) {
      return {
        ok: false,
        status: 409,
        message: `Pending action cannot be decided: ${decisionResult.reason}`,
      };
    }

    const requestId = payload.requestId ?? decisionResult.action.requestId;
    const responseEvents: Record<string, unknown>[] = [];
    if (input.decision === 'accepted') {
      responseEvents.push(
        toEventWithRequestId({
          event: {
            type: 'Conversation/Document Bootstrap Responded',
            status: 'accepted',
          },
          requestId,
        })
      );
    } else {
      responseEvents.push(
        toEventWithRequestId({
          event: {
            type: 'Conversation/Document Bootstrap Responded',
            status: 'rejected',
            reason: 'Payment mandate bootstrap rejected by user.',
          },
          requestId,
        })
      );
    }

    return {
      ok: true,
      outcome: {
        kind: 'payment-mandate-bootstrap',
        contract: decisionResult.contract,
        requestId,
        ...(input.decision === 'accepted' && paymentMandateSessionId
          ? {
              paymentMandateBootstrapSessionId: paymentMandateSessionId,
            }
          : {}),
        responseEvents,
        historyShort:
          input.decision === 'accepted'
            ? 'Payment Mandate bootstrap approved.'
            : 'Payment Mandate bootstrap rejected.',
        historyMore:
          input.decision === 'accepted'
            ? 'Payment Mandate bootstrap accepted; waiting for target session start.'
            : 'Payment Mandate bootstrap request was rejected by user.',
      },
    };
  }

  return {
    ok: false,
    status: 409,
    message: 'Pending action cannot be decided: unsupported-action',
  };
};

export const decideContractPendingActionHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['decideContractPendingAction']
  >,
  context: { request: MaybeAuthenticatedTsRestRequestContext }
) => {
  const { contractRepository, myOsClient, logger, bootstrapContextRepository } =
    await getDependencies();
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

  const decidedAt = new Date().toISOString();
  const decisionOutcome = await resolveDecisionOutcome({
    contract,
    actionId,
    decision,
    decidedAt,
    myOsClient,
    credentials,
  });

  if (!decisionOutcome.ok) {
    return problemResponse({
      status: decisionOutcome.status,
      code:
        decisionOutcome.status === 409
          ? ERROR_CODES.VALIDATION_ERROR
          : ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      message: decisionOutcome.message,
      detail: decisionOutcome.detail,
    });
  }

  if (
    decisionOutcome.outcome.kind !== 'monitoring' &&
    decisionOutcome.outcome.paymentMandateBootstrapSessionId
  ) {
    await bootstrapContextRepository.saveContext({
      bootstrapSessionId:
        decisionOutcome.outcome.paymentMandateBootstrapSessionId,
      ...(contract.merchantId ? { merchantId: contract.merchantId } : {}),
      ...(contract.accountNumber
        ? { accountNumber: contract.accountNumber }
        : {}),
      ...(contract.userId ? { userId: contract.userId } : {}),
      ...(contract.customerChannelKey
        ? { customerChannelKey: contract.customerChannelKey }
        : {}),
      ...(contract.sessionId
        ? { requestingSessionId: contract.sessionId }
        : {}),
      ...(decisionOutcome.outcome.requestId
        ? { requestId: decisionOutcome.outcome.requestId }
        : {}),
      createdAt: decidedAt,
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
    request: decisionOutcome.outcome.responseEvents,
    logs,
    logContext: {
      sessionId,
      actionId,
      decision,
      kind: decisionOutcome.outcome.kind,
      targetMerchantId:
        decisionOutcome.outcome.kind === 'monitoring'
          ? decisionOutcome.outcome.targetMerchantId
          : undefined,
    },
    successMessage: `Reported pending action decision (${decision}) via guarantorUpdate`,
    failureMessage: `Failed to report pending action decision (${decision}) via guarantorUpdate`,
    missingCredentialsMessage:
      'Failed to report pending action decision (missing credentials)',
  });

  if (!emitted) {
    const details = logs.find(entry => entry.level === 'error');
    return problemResponse({
      status: 500,
      code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      message: 'Failed to report pending action decision',
      detail: details?.message,
    });
  }

  const updatedAt = new Date().toISOString();
  await contractRepository.saveContract({
    ...decisionOutcome.outcome.contract,
    updatedAt,
  });

  await contractRepository.addContractHistoryEntry({
    contractId: contract.contractId,
    kind: 'bankLifecycle',
    short: decisionOutcome.outcome.historyShort,
    more: decisionOutcome.outcome.historyMore,
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
