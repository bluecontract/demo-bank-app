import type {
  ContractMonitoringSubscription,
  ContractPendingAction,
  ContractPendingActionStatus,
  ContractRecord,
} from './ports';

const DEFAULT_MONITORING_EVENTS = ['transaction'] as const;

export type MonitoringReportStatus =
  | 'authorized'
  | 'partially captured'
  | 'captured';

export const buildMonitoringSubscriptionId = (targetMerchantId: string) =>
  `card-monitoring:${targetMerchantId}`;

export const buildMonitoringPendingActionId = (subscriptionId: string) =>
  `${subscriptionId}:consent`;

export const normalizeMonitoringEvents = (events: string[] | undefined) => {
  const normalized = (events ?? DEFAULT_MONITORING_EVENTS)
    .map(event => event.trim().toLowerCase())
    .filter(Boolean);
  return normalized.length ? Array.from(new Set(normalized)) : ['transaction'];
};

export const supportsOnlyTransactionMonitoringEvents = (
  events: string[]
): boolean => events.every(event => event === 'transaction');

export const resolveMonitoringReportStatusFromHoldStatus = (
  holdStatus: string | undefined
): MonitoringReportStatus | null => {
  if (holdStatus === 'PENDING') {
    return 'authorized';
  }
  if (holdStatus === 'PARTIALLY_CAPTURED') {
    return 'partially captured';
  }
  if (holdStatus === 'CAPTURED') {
    return 'captured';
  }
  return null;
};

export type UpsertMonitoringRequestInput = {
  contract: ContractRecord;
  targetMerchantId: string;
  requestedEvents: string[];
  requestEventId: string;
  requestEventIndex: number;
  requestedAt: string;
  requestId?: string;
  pendingActionTitle?: string;
  pendingActionSummary?: string;
};

export type UpsertMonitoringRequestResult =
  | {
      changed: false;
      reason: 'already-active' | 'already-pending';
      subscription: ContractMonitoringSubscription;
    }
  | {
      changed: true;
      contract: ContractRecord;
      action: ContractPendingAction;
      subscription: ContractMonitoringSubscription;
    };

export const upsertMonitoringRequestInContract = (
  input: UpsertMonitoringRequestInput
): UpsertMonitoringRequestResult => {
  const {
    contract,
    targetMerchantId,
    requestedEvents,
    requestEventId,
    requestEventIndex,
    requestedAt,
    requestId,
    pendingActionTitle,
    pendingActionSummary,
  } = input;

  const existingSubscriptions = contract.monitoringSubscriptions ?? [];
  const existingSubscription = existingSubscriptions.find(
    item => item.targetMerchantId === targetMerchantId
  );

  if (existingSubscription?.status === 'active') {
    return {
      changed: false,
      reason: 'already-active',
      subscription: existingSubscription,
    };
  }

  if (existingSubscription?.status === 'pending') {
    return {
      changed: false,
      reason: 'already-pending',
      subscription: existingSubscription,
    };
  }

  const subscriptionId =
    existingSubscription?.subscriptionId ??
    buildMonitoringSubscriptionId(targetMerchantId);
  const pendingActionId = buildMonitoringPendingActionId(subscriptionId);

  const nextSubscription: ContractMonitoringSubscription = {
    subscriptionId,
    targetMerchantId,
    requestedEvents,
    status: 'pending',
    pendingActionId,
    requestEventId,
    requestEventIndex,
    createdAt: existingSubscription?.createdAt ?? requestedAt,
    updatedAt: requestedAt,
    ...(requestId ? { requestId } : {}),
  };

  const nextAction: ContractPendingAction = {
    actionId: pendingActionId,
    type: 'monitoringConsentApproval',
    status: 'pending',
    title: pendingActionTitle ?? 'Allow card transaction monitoring',
    summary:
      pendingActionSummary ??
      `Allow monitoring transactions for merchant ${targetMerchantId}.`,
    targetMerchantId,
    requestedEvents,
    createdAt: requestedAt,
    ...(requestId ? { requestId } : {}),
  };

  const nextSubscriptions = existingSubscriptions.filter(
    item => item.targetMerchantId !== targetMerchantId
  );
  nextSubscriptions.push(nextSubscription);

  const existingActions = contract.pendingActions ?? [];
  const nextActions = existingActions.filter(
    action => action.actionId !== pendingActionId
  );
  nextActions.push(nextAction);

  return {
    changed: true,
    contract: {
      ...contract,
      pendingActions: nextActions,
      monitoringSubscriptions: nextSubscriptions,
    },
    action: nextAction,
    subscription: nextSubscription,
  };
};

export type ApplyMonitoringDecisionInput = {
  contract: ContractRecord;
  actionId: string;
  decision: Extract<ContractPendingActionStatus, 'accepted' | 'rejected'>;
  decidedAt: string;
};

export type ApplyMonitoringDecisionResult =
  | {
      ok: false;
      reason:
        | 'action-not-found'
        | 'action-not-pending'
        | 'subscription-not-found';
    }
  | {
      ok: true;
      contract: ContractRecord;
      action: ContractPendingAction;
      subscription: ContractMonitoringSubscription;
    };

export const applyMonitoringDecisionToContract = (
  input: ApplyMonitoringDecisionInput
): ApplyMonitoringDecisionResult => {
  const { contract, actionId, decision, decidedAt } = input;
  const actions = contract.pendingActions ?? [];
  const action = actions.find(item => item.actionId === actionId);

  if (!action || action.type !== 'monitoringConsentApproval') {
    return { ok: false, reason: 'action-not-found' };
  }

  if (action.status !== 'pending') {
    return { ok: false, reason: 'action-not-pending' };
  }

  const subscriptions = contract.monitoringSubscriptions ?? [];
  const subscription = subscriptions.find(
    item =>
      item.pendingActionId === actionId ||
      item.targetMerchantId === action.targetMerchantId
  );

  if (!subscription) {
    return { ok: false, reason: 'subscription-not-found' };
  }

  const nextAction: ContractPendingAction = {
    ...action,
    status: decision,
    decidedAt,
  };

  const subscriptionBase: ContractMonitoringSubscription = {
    ...subscription,
  };
  delete (subscriptionBase as { pendingActionId?: string }).pendingActionId;
  delete (subscriptionBase as { activatedAt?: string }).activatedAt;
  delete (subscriptionBase as { rejectedAt?: string }).rejectedAt;

  const nextSubscription: ContractMonitoringSubscription =
    decision === 'accepted'
      ? {
          ...subscriptionBase,
          status: 'active',
          updatedAt: decidedAt,
          activatedAt: decidedAt,
        }
      : {
          ...subscriptionBase,
          status: 'rejected',
          updatedAt: decidedAt,
          rejectedAt: decidedAt,
        };

  const nextActions = actions.map(item =>
    item.actionId === actionId ? nextAction : item
  );
  const nextSubscriptions = subscriptions.map(item =>
    item.subscriptionId === subscription.subscriptionId
      ? nextSubscription
      : item
  );

  return {
    ok: true,
    contract: {
      ...contract,
      pendingActions: nextActions,
      monitoringSubscriptions: nextSubscriptions,
    },
    action: nextAction,
    subscription: nextSubscription,
  };
};

export const getActiveMonitoringSubscriptions = (
  contract: ContractRecord,
  targetMerchantId: string
) =>
  (contract.monitoringSubscriptions ?? []).filter(
    subscription =>
      subscription.status === 'active' &&
      subscription.targetMerchantId === targetMerchantId
  );
