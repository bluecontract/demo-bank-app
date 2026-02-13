import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  applyMonitoringDecisionToContract,
  type ContractPendingAction,
  type ContractPendingActionStatus,
  type ContractRecord,
} from '@demo-bank-app/contracts';
import { blue, runGuarantorUpdate } from '@demo-bank-app/paynotes';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';

const CHARGE_MANDATE_PENDING_ACTION_TYPE = 'chargeMandateApproval';
const PAYMENT_MANDATE_BOOTSTRAP_PENDING_ACTION_TYPE =
  'paymentMandateBootstrapApproval';

type PendingActionDecision = Extract<
  ContractPendingActionStatus,
  'accepted' | 'rejected'
>;

type ChargeMandatePayload = {
  amountMinor: number;
  direction: 'linked' | 'reverse';
  payNoteDocument?: Record<string, unknown>;
};

type PaymentMandateBootstrapPayload = {
  requestId?: string;
  channelBindings?: Record<string, { accountId?: string; email?: string }>;
  paymentMandateDocument: Record<string, unknown>;
};

type PaymentMandateSnapshot = {
  amountLimit?: number;
  amountReserved?: number;
  amountCaptured?: number;
  currency?: string;
  sourceAccount?: string;
  allowLinkedPayNote?: boolean;
  granteeType?: string;
  granteeId?: string;
  granterType?: string;
  granterId?: string;
  expiresAt?: string;
  revokedAt?: string;
  allowedPaymentCounterparties?: Array<{
    counterpartyType?: string;
    counterpartyId?: string;
  }>;
  allowedPayNotes?: Array<{ typeBlueId?: string; documentBlueId?: string }>;
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

type ChargeMandateDecisionOutcome = {
  kind: 'charge-mandate';
  contract: ContractRecord;
  responseEvents: Record<string, unknown>[];
  requestId?: string;
  historyShort: string;
  historyMore: string;
};

type PaymentMandateBootstrapDecisionOutcome = {
  kind: 'payment-mandate-bootstrap';
  contract: ContractRecord;
  responseEvents: Record<string, unknown>[];
  requestId?: string;
  historyShort: string;
  historyMore: string;
};

type DecisionOutcome =
  | MonitoringDecisionOutcome
  | ChargeMandateDecisionOutcome
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

const getNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const getBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

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

const resolvePayNoteTypeBlueId = (
  payNoteDocument: Record<string, unknown> | undefined
): string | undefined => {
  if (!payNoteDocument) {
    return undefined;
  }

  try {
    const simple = blue.nodeToJson(
      blue.jsonValueToNode(payNoteDocument),
      'simple'
    ) as { type?: { blueId?: unknown } } | undefined;
    const blueId = simple?.type?.blueId;
    return typeof blueId === 'string' && blueId.length > 0 ? blueId : undefined;
  } catch {
    return undefined;
  }
};

const parseChargeMandatePayload = (
  action: ContractPendingAction
): ChargeMandatePayload | null => {
  const payload = toRecord(action.payload);
  if (!payload) {
    return null;
  }

  const amountMinor = getNumber(payload.amountMinor);
  const direction = getString(payload.direction);
  const payNoteDocument = toRecord(payload.payNoteDocument) ?? undefined;

  if (
    amountMinor === undefined ||
    !Number.isInteger(amountMinor) ||
    amountMinor <= 0 ||
    (direction !== 'linked' && direction !== 'reverse')
  ) {
    return null;
  }

  return {
    amountMinor,
    direction,
    payNoteDocument,
  };
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

const applyChargeMandateDecisionToContract = (input: {
  contract: ContractRecord;
  actionId: string;
  decision: PendingActionDecision;
  decidedAt: string;
  paymentMandateDocumentId?: string;
  paymentMandateSessionId?: string;
  paymentMandate?: PaymentMandateSnapshot;
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
    paymentMandate,
  } = input;

  const action = (contract.pendingActions ?? []).find(
    item => item.actionId === actionId
  );
  if (!action) {
    return { ok: false, reason: 'action-not-found' };
  }
  if (action.type !== CHARGE_MANDATE_PENDING_ACTION_TYPE) {
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
    ...(paymentMandate
      ? {
          paymentMandate,
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

const buildPaymentMandateDocument = (input: {
  contract: ContractRecord;
  payload: ChargeMandatePayload;
}):
  | {
      ok: true;
      document: Record<string, unknown>;
    }
  | { ok: false; reason: string } => {
  const { contract, payload } = input;

  const granterType = payload.direction === 'reverse' ? 'merchant' : 'customer';
  const granterId =
    granterType === 'merchant'
      ? getString(contract.merchantId)
      : getString(contract.userId);
  const granteeId = getString(contract.documentId);

  if (!granterId) {
    return {
      ok: false,
      reason: 'Unable to resolve mandate granter from contract context.',
    };
  }

  if (!granteeId) {
    return {
      ok: false,
      reason: 'Unable to resolve mandate grantee document id.',
    };
  }

  const payNoteTypeBlueId = resolvePayNoteTypeBlueId(payload.payNoteDocument);
  const allowLinkedPayNote = Boolean(
    payload.payNoteDocument && payNoteTypeBlueId
  );

  const allowedPaymentCounterparties =
    payload.direction === 'reverse'
      ? getString(contract.userId)
        ? [
            {
              counterpartyType: 'customerId',
              counterpartyId: getString(contract.userId),
            },
          ]
        : undefined
      : getString(contract.merchantId)
      ? [
          {
            counterpartyType: 'merchantId',
            counterpartyId: getString(contract.merchantId),
          },
        ]
      : undefined;

  return {
    ok: true,
    document: {
      type: 'PayNote/Payment Mandate',
      granterType,
      granterId,
      granteeType: 'documentId',
      granteeId,
      amountLimit: payload.amountMinor,
      currency: 'USD',
      sourceAccount: 'root',
      allowLinkedPayNote,
      ...(payNoteTypeBlueId
        ? {
            allowedPayNotes: [{ typeBlueId: payNoteTypeBlueId }],
          }
        : {}),
      ...(allowedPaymentCounterparties
        ? {
            allowedPaymentCounterparties,
          }
        : {}),
    },
  };
};

const buildPaymentMandateSnapshot = (
  document: Record<string, unknown>
): PaymentMandateSnapshot => {
  const allowedPaymentCounterparties = Array.isArray(
    document.allowedPaymentCounterparties
  )
    ? document.allowedPaymentCounterparties.reduce<
        Array<{ counterpartyType?: string; counterpartyId?: string }>
      >((acc, item) => {
        const itemRecord = toRecord(item);
        if (!itemRecord) {
          return acc;
        }
        const counterpartyType = getString(itemRecord.counterpartyType);
        const counterpartyId = getString(itemRecord.counterpartyId);
        if (!counterpartyType || !counterpartyId) {
          return acc;
        }
        acc.push({ counterpartyType, counterpartyId });
        return acc;
      }, [])
    : undefined;

  const allowedPayNotes = Array.isArray(document.allowedPayNotes)
    ? document.allowedPayNotes.reduce<
        Array<{ typeBlueId?: string; documentBlueId?: string }>
      >((acc, item) => {
        const itemRecord = toRecord(item);
        if (!itemRecord) {
          return acc;
        }
        const typeBlueId = getString(itemRecord.typeBlueId);
        const documentBlueId = getString(itemRecord.documentBlueId);
        if (!typeBlueId && !documentBlueId) {
          return acc;
        }
        acc.push({ typeBlueId, documentBlueId });
        return acc;
      }, [])
    : undefined;

  return {
    amountLimit: getNumber(document.amountLimit),
    amountReserved: getNumber(document.amountReserved),
    amountCaptured: getNumber(document.amountCaptured),
    currency: getString(document.currency),
    sourceAccount: getString(document.sourceAccount),
    allowLinkedPayNote: getBoolean(document.allowLinkedPayNote),
    granteeType: getString(document.granteeType),
    granteeId: getString(document.granteeId),
    granterType: getString(document.granterType),
    granterId: getString(document.granterId),
    expiresAt: getString(document.expiresAt),
    revokedAt: getString(document.revokedAt),
    ...(allowedPaymentCounterparties ? { allowedPaymentCounterparties } : {}),
    ...(allowedPayNotes ? { allowedPayNotes } : {}),
  };
};

const resolveMandateDocumentIdFromBootstrap = async (input: {
  myOsClient: Awaited<ReturnType<typeof getDependencies>>['myOsClient'];
  bootstrapBody?: unknown;
}): Promise<string | undefined> => {
  const bootstrapBody = toRecord(input.bootstrapBody);
  const directDocumentId = getString(bootstrapBody?.documentId);
  if (directDocumentId) {
    return directDocumentId;
  }

  const sessionId = getString(bootstrapBody?.sessionId);
  if (!sessionId) {
    return undefined;
  }

  const fetchResult = await input.myOsClient.fetchDocument(sessionId);
  if (fetchResult.kind !== 'success') {
    return undefined;
  }

  return getString(fetchResult.document.documentId);
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

  if (action.type === CHARGE_MANDATE_PENDING_ACTION_TYPE) {
    const payload = parseChargeMandatePayload(action);
    if (!payload) {
      return {
        ok: false,
        status: 409,
        message: 'Pending action cannot be decided: invalid mandate payload',
      };
    }

    let paymentMandateDocumentId: string | undefined;
    let paymentMandateSessionId: string | undefined;
    let paymentMandateSnapshot: PaymentMandateSnapshot | undefined;
    if (input.decision === 'accepted') {
      const mandateDocumentResult = buildPaymentMandateDocument({
        contract: input.contract,
        payload,
      });
      if (!mandateDocumentResult.ok) {
        return {
          ok: false,
          status: 409,
          message: 'Pending action cannot be decided: invalid mandate context',
          detail: mandateDocumentResult.reason,
        };
      }

      const bootstrapResponse = await input.myOsClient.bootstrapDocument({
        credentials: input.credentials,
        payload: {
          channelBindings: {},
          document: mandateDocumentResult.document,
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
      paymentMandateDocumentId = await resolveMandateDocumentIdFromBootstrap({
        myOsClient: input.myOsClient,
        bootstrapBody: bootstrapResponse.body,
      });
      if (!paymentMandateDocumentId) {
        return {
          ok: false,
          status: 500,
          message: 'Failed to bootstrap payment mandate document',
          detail: 'Payment mandate bootstrap did not return document identity.',
        };
      }
      paymentMandateSnapshot = buildPaymentMandateSnapshot(
        mandateDocumentResult.document
      );
    }

    const decisionResult = applyChargeMandateDecisionToContract({
      contract: input.contract,
      actionId: input.actionId,
      decision: input.decision,
      decidedAt: input.decidedAt,
      paymentMandateDocumentId,
      paymentMandateSessionId,
      paymentMandate: paymentMandateSnapshot,
    });
    if (!decisionResult.ok) {
      return {
        ok: false,
        status: 409,
        message: `Pending action cannot be decided: ${decisionResult.reason}`,
      };
    }

    const responseEvent = toEventWithRequestId({
      event:
        input.decision === 'accepted'
          ? {
              type: 'PayNote/Card Charge Responded',
              status: 'accepted',
              reason: 'Payment mandate approved by user.',
              ...(paymentMandateDocumentId
                ? {
                    paymentMandateDocumentId,
                  }
                : {}),
            }
          : {
              type: 'PayNote/Card Charge Responded',
              status: 'rejected',
              reason: 'Payment mandate rejected by user.',
            },
      requestId: decisionResult.action.requestId,
    });

    return {
      ok: true,
      outcome: {
        kind: 'charge-mandate',
        contract: decisionResult.contract,
        requestId: decisionResult.action.requestId,
        responseEvents: [responseEvent],
        historyShort:
          input.decision === 'accepted'
            ? 'Payment mandate approved.'
            : 'Payment mandate rejected.',
        historyMore:
          input.decision === 'accepted'
            ? 'Card charge request can proceed with the approved mandate.'
            : 'Card charge request was rejected by user decision.',
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
      const bootstrapResponse = await input.myOsClient.bootstrapDocument({
        credentials: input.credentials,
        payload: {
          channelBindings: payload.channelBindings ?? {},
          document: payload.paymentMandateDocument,
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
      paymentMandateDocumentId = await resolveMandateDocumentIdFromBootstrap({
        myOsClient: input.myOsClient,
        bootstrapBody: bootstrapResponse.body,
      });
      if (!paymentMandateDocumentId) {
        return {
          ok: false,
          status: 500,
          message: 'Failed to bootstrap payment mandate document',
          detail: 'Payment mandate bootstrap did not return document identity.',
        };
      }
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
      responseEvents.push(
        toEventWithRequestId({
          event: {
            type: 'Conversation/Document Bootstrap Completed',
            documentId: paymentMandateDocumentId,
          },
          requestId,
        })
      );
      responseEvents.push(
        toEventWithRequestId({
          event: {
            type: 'PayNote/Payment Mandate Attached',
            paymentMandateDocumentId,
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
        responseEvents,
        historyShort:
          input.decision === 'accepted'
            ? 'Payment Mandate bootstrap approved.'
            : 'Payment Mandate bootstrap rejected.',
        historyMore:
          input.decision === 'accepted'
            ? 'Payment Mandate document was bootstrapped and attached to contract.'
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
