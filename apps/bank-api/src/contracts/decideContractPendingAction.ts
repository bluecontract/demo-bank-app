import { ServerInferRequest } from '@ts-rest/core';
import { BlueNode, Properties } from '@blue-labs/language';
import commonBlueIds from '@blue-repository/types/packages/common/blue-ids';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import {
  applyMonitoringDecisionToContract,
  type ContractPendingAction,
  type ContractPendingCustomerAction,
  type ContractPendingActionStatus,
  type ContractRecord,
  type CustomerContractPendingAction,
} from '@demo-bank-app/contracts';
import { blue, runGuarantorUpdate } from '@demo-bank-app/paynotes';
import {
  extractAuthInfo,
  type MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { getDependencies } from '../paynote/dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';

const PAYMENT_MANDATE_BOOTSTRAP_PENDING_ACTION_TYPE =
  'paymentMandateBootstrapApproval';
const CUSTOMER_ACTION_OPTIONS_PENDING_ACTION_TYPE = 'customerActionOptions';
const CUSTOMER_ACTION_INPUT_PENDING_ACTION_TYPE = 'customerActionInput';
const CUSTOMER_ACTION_RESPONDED_EVENT_NAME =
  'Conversation/Customer Action Responded';
const COMMON_TIMESTAMP_BLUE_ID = commonBlueIds['Common/Timestamp'];

type PendingActionDecision = Extract<
  ContractPendingActionStatus,
  'accepted' | 'rejected'
>;

type PendingActionDecisionRequest = ServerInferRequest<
  (typeof bankApiContract)['banking']['decideContractPendingAction']
>['body'];

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

type CustomerActionDecisionOutcome = {
  kind: 'customer-action';
  contract: ContractRecord;
  responseEvents: Record<string, unknown>[];
  requestId?: string;
  actionLabel: string;
  historyShort: string;
  historyMore: string;
};

type DecisionOutcome =
  | MonitoringDecisionOutcome
  | PaymentMandateBootstrapDecisionOutcome
  | CustomerActionDecisionOutcome;

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

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const getBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const isCustomerActionType = (
  action: ContractPendingAction
): action is CustomerContractPendingAction =>
  action.type === CUSTOMER_ACTION_OPTIONS_PENDING_ACTION_TYPE ||
  action.type === CUSTOMER_ACTION_INPUT_PENDING_ACTION_TYPE;

const normalizeCustomerActionOptions = (
  action: CustomerContractPendingAction
) =>
  (action.actions ?? []).reduce<ContractPendingCustomerAction[]>(
    (acc, option) => {
      const label = getString(option.label);
      if (!label) {
        return acc;
      }
      const description = getString(option.description);
      const variant =
        option.variant === 'primary' ||
        option.variant === 'secondary' ||
        option.variant === 'reject'
          ? option.variant
          : undefined;
      acc.push({
        label,
        ...(description ? { description } : {}),
        ...(variant ? { variant } : {}),
        ...(option.inputSchema !== undefined
          ? { inputSchema: option.inputSchema }
          : {}),
        ...(option.inputRequired !== undefined
          ? { inputRequired: option.inputRequired }
          : {}),
        ...(option.inputTitle ? { inputTitle: option.inputTitle } : {}),
        ...(option.inputPlaceholder
          ? { inputPlaceholder: option.inputPlaceholder }
          : {}),
      });
      return acc;
    },
    []
  );

const resolveActionDecisionStatus = (
  variant: string | undefined
): PendingActionDecision => (variant === 'reject' ? 'rejected' : 'accepted');

const hasStructuredProperties = (schemaNode: BlueNode): boolean =>
  Object.keys(schemaNode.getProperties() ?? {}).some(
    key => key !== Properties.OBJECT_CONTRACTS
  );

const resolveRootTypeBlueId = (schemaNode: BlueNode): string | undefined =>
  schemaNode.getType()?.getBlueId() ??
  schemaNode.getType()?.getType()?.getBlueId();

const hasMeaningfulInputValue = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
};

const validateTypedInputWithBlue = (input: {
  schema: unknown;
  value: unknown;
}): { ok: true; typedInput: unknown } | { ok: false; reason: string } => {
  let schemaNode: BlueNode;
  try {
    schemaNode = blue.jsonValueToNode(input.schema);
  } catch {
    return {
      ok: false,
      reason: 'input schema cannot be parsed by Blue',
    };
  }

  const rootTypeBlueId = resolveRootTypeBlueId(schemaNode);
  if (
    rootTypeBlueId === Properties.TEXT_TYPE_BLUE_ID &&
    typeof input.value !== 'string'
  ) {
    return { ok: false, reason: 'input must be a text value' };
  }
  if (
    rootTypeBlueId === Properties.BOOLEAN_TYPE_BLUE_ID &&
    typeof input.value !== 'boolean'
  ) {
    return { ok: false, reason: 'input must be a boolean value' };
  }
  if (
    rootTypeBlueId === Properties.INTEGER_TYPE_BLUE_ID &&
    !Number.isInteger(input.value)
  ) {
    return { ok: false, reason: 'input must be an integer value' };
  }
  if (
    rootTypeBlueId === Properties.DOUBLE_TYPE_BLUE_ID &&
    (typeof input.value !== 'number' || !Number.isFinite(input.value))
  ) {
    return { ok: false, reason: 'input must be a number value' };
  }
  if (rootTypeBlueId === COMMON_TIMESTAMP_BLUE_ID) {
    const timestamp = getString(input.value);
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
      return { ok: false, reason: 'input must be a valid timestamp value' };
    }
  }

  if (schemaNode.getItemType() && !Array.isArray(input.value)) {
    return { ok: false, reason: 'input must be a list value' };
  }
  if (schemaNode.getValueType() && !toRecord(input.value)) {
    return { ok: false, reason: 'input must be a dictionary value' };
  }
  if (hasStructuredProperties(schemaNode) && !toRecord(input.value)) {
    return { ok: false, reason: 'input must be an object value' };
  }

  try {
    const typedNode = blue.jsonValueToNode(input.value);
    typedNode.setType(schemaNode);
    blue.resolve(typedNode.clone());
    return {
      ok: true,
      typedInput: blue.nodeToJson(typedNode, 'official'),
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `input does not match schema: ${error.message}`
          : 'input does not match schema',
    };
  }
};

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

const applyCustomerActionDecisionToContract = (input: {
  contract: ContractRecord;
  actionId: string;
  status: PendingActionDecision;
  decidedAt: string;
  actionLabel: string;
  decisionInput?: unknown;
}):
  | { ok: true; contract: ContractRecord; action: ContractPendingAction }
  | {
      ok: false;
      reason: 'action-not-found' | 'action-not-pending' | 'unsupported-action';
    } => {
  const action = (input.contract.pendingActions ?? []).find(
    item => item.actionId === input.actionId
  );
  if (!action) {
    return { ok: false, reason: 'action-not-found' };
  }
  if (!isCustomerActionType(action)) {
    return { ok: false, reason: 'unsupported-action' };
  }
  if (action.status !== 'pending') {
    return { ok: false, reason: 'action-not-pending' };
  }

  const nextAction: CustomerContractPendingAction = {
    ...action,
    status: input.status,
    decidedAt: input.decidedAt,
    decisionPayload: {
      actionLabel: input.actionLabel,
      ...(input.decisionInput !== undefined
        ? { input: input.decisionInput }
        : {}),
    },
  };

  const nextActions = (input.contract.pendingActions ?? []).map(item =>
    item.actionId === input.actionId ? nextAction : item
  );

  return {
    ok: true,
    contract: {
      ...input.contract,
      pendingActions: nextActions,
    },
    action: nextAction,
  };
};

const resolveDecisionOutcome = async (input: {
  contract: ContractRecord;
  actionId: string;
  decision: PendingActionDecisionRequest;
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

  if (input.decision.kind === 'approveReject') {
    const decision = input.decision.input;

    if (action.type === 'monitoringConsentApproval') {
      const decisionResult = applyMonitoringDecisionToContract({
        contract: input.contract,
        actionId: input.actionId,
        decision,
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
            decision === 'accepted'
              ? 'Monitoring consent granted.'
              : 'Monitoring consent rejected.',
          historyMore:
            decision === 'accepted'
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
      if (decision === 'accepted') {
        const mandateIdentityMaterialization =
          materializePaymentMandateIdentityFromContract({
            contract: input.contract,
            paymentMandateDocument: payload.paymentMandateDocument,
          });
        if (!mandateIdentityMaterialization.ok) {
          return {
            ok: false,
            status: 409,
            message:
              'Pending action cannot be decided: invalid mandate context',
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
        decision,
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
      if (decision === 'accepted') {
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
          ...(decision === 'accepted' && paymentMandateSessionId
            ? {
                paymentMandateBootstrapSessionId: paymentMandateSessionId,
              }
            : {}),
          responseEvents,
          historyShort:
            decision === 'accepted'
              ? 'Payment Mandate bootstrap approved.'
              : 'Payment Mandate bootstrap rejected.',
          historyMore:
            decision === 'accepted'
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
  }

  if (!isCustomerActionType(action)) {
    return {
      ok: false,
      status: 409,
      message: 'Pending action cannot be decided: unsupported-decision-kind',
    };
  }

  if (action.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      message: 'Pending action cannot be decided: action-not-pending',
    };
  }

  const options = normalizeCustomerActionOptions(action);
  if (options.length === 0) {
    return {
      ok: false,
      status: 409,
      message: 'Pending action cannot be decided: no-actions-defined',
    };
  }

  const optionsWithInput = options.filter(option => option.inputSchema);
  let selectedOption:
    | {
        label: string;
        variant?: 'primary' | 'secondary' | 'reject';
        inputSchema?: unknown;
        inputRequired?: boolean;
      }
    | undefined;
  let decisionInputForStorage: unknown;
  let responseInput: unknown;

  if (input.decision.kind === 'selectOption') {
    const optionLabel = getString(input.decision.input);
    if (!optionLabel) {
      return {
        ok: false,
        status: 409,
        message: 'Pending action cannot be decided: option label is required',
      };
    }

    selectedOption = options.find(option => option.label === optionLabel);
    if (!selectedOption) {
      return {
        ok: false,
        status: 409,
        message: 'Pending action cannot be decided: option label not found',
      };
    }

    if (
      selectedOption.inputSchema &&
      getBoolean(selectedOption.inputRequired)
    ) {
      return {
        ok: false,
        status: 409,
        message:
          'Pending action cannot be decided: selected option requires submitInput',
      };
    }
  } else if (input.decision.kind === 'submitInput') {
    if (optionsWithInput.length === 0) {
      return {
        ok: false,
        status: 409,
        message:
          'Pending action cannot be decided: no option with input schema defined',
      };
    }

    const submitRecord = toRecord(input.decision.input);
    const submitActionLabel = getString(submitRecord?.actionLabel);

    if (submitActionLabel) {
      selectedOption = options.find(
        option => option.label === submitActionLabel
      );
      if (!selectedOption) {
        return {
          ok: false,
          status: 409,
          message: 'Pending action cannot be decided: option label not found',
        };
      }
    } else if (optionsWithInput.length === 1) {
      selectedOption = optionsWithInput[0];
    } else {
      return {
        ok: false,
        status: 409,
        message:
          'Pending action cannot be decided: actionLabel is required when multiple input options are available',
      };
    }

    if (!selectedOption?.inputSchema) {
      return {
        ok: false,
        status: 409,
        message:
          'Pending action cannot be decided: selected option does not accept input',
      };
    }

    const rawSubmittedInput =
      submitRecord && 'value' in submitRecord
        ? submitRecord.value
        : submitRecord && 'input' in submitRecord
        ? submitRecord.input
        : submitRecord && submitActionLabel
        ? undefined
        : input.decision.input;

    if (!hasMeaningfulInputValue(rawSubmittedInput)) {
      if (getBoolean(selectedOption.inputRequired)) {
        return {
          ok: false,
          status: 409,
          message: 'Pending action cannot be decided: input is required',
        };
      }
    } else {
      const validation = validateTypedInputWithBlue({
        schema: selectedOption.inputSchema,
        value: rawSubmittedInput,
      });
      if (!validation.ok) {
        return {
          ok: false,
          status: 409,
          message: 'Pending action cannot be decided: invalid input payload',
          detail: validation.reason,
        };
      }
      decisionInputForStorage = rawSubmittedInput;
      responseInput = validation.typedInput;
    }
  } else {
    return {
      ok: false,
      status: 409,
      message: 'Pending action cannot be decided: unsupported-decision-kind',
    };
  }

  if (!selectedOption) {
    return {
      ok: false,
      status: 409,
      message: 'Pending action cannot be decided: option label not found',
    };
  }

  const decisionStatus = resolveActionDecisionStatus(selectedOption.variant);
  const decisionResult = applyCustomerActionDecisionToContract({
    contract: input.contract,
    actionId: input.actionId,
    status: decisionStatus,
    decidedAt: input.decidedAt,
    actionLabel: selectedOption.label,
    decisionInput: decisionInputForStorage,
  });
  if (!decisionResult.ok) {
    return {
      ok: false,
      status: 409,
      message: `Pending action cannot be decided: ${decisionResult.reason}`,
    };
  }

  const responseEvent = toEventWithRequestId({
    event: {
      type: CUSTOMER_ACTION_RESPONDED_EVENT_NAME,
      actionLabel: selectedOption.label,
      respondedAt: {
        type: {
          blueId: COMMON_TIMESTAMP_BLUE_ID,
        },
        value: input.decidedAt,
      },
      ...(responseInput !== undefined ? { input: responseInput } : {}),
    },
    requestId: action.requestId,
  });

  return {
    ok: true,
    outcome: {
      kind: 'customer-action',
      contract: decisionResult.contract,
      requestId: action.requestId,
      actionLabel: selectedOption.label,
      responseEvents: [responseEvent],
      historyShort:
        decisionStatus === 'rejected'
          ? 'Customer action rejected.'
          : 'Customer action completed.',
      historyMore:
        decisionInputForStorage !== undefined
          ? `Customer selected "${selectedOption.label}" and provided input.`
          : `Customer selected "${selectedOption.label}".`,
    },
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
  const decisionKind = request.body.kind;

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
    decision: request.body,
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
    decisionOutcome.outcome.kind === 'payment-mandate-bootstrap' &&
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
      decisionKind,
      kind: decisionOutcome.outcome.kind,
      targetMerchantId:
        decisionOutcome.outcome.kind === 'monitoring'
          ? decisionOutcome.outcome.targetMerchantId
          : undefined,
      actionLabel:
        decisionOutcome.outcome.kind === 'customer-action'
          ? decisionOutcome.outcome.actionLabel
          : undefined,
    },
    successMessage: `Reported pending action decision (${decisionKind}) via guarantorUpdate`,
    failureMessage: `Failed to report pending action decision (${decisionKind}) via guarantorUpdate`,
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
