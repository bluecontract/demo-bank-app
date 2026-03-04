export type ContractStatusTimestamps = Record<string, string>;

export type ContractPendingActionType =
  | 'monitoringConsentApproval'
  | 'paymentMandateBootstrapApproval'
  | 'customerActionOptions'
  | 'customerActionInput';

export type ContractPendingActionStatus = 'pending' | 'accepted' | 'rejected';

export type ContractPendingCustomerActionVariant =
  | 'primary'
  | 'secondary'
  | 'reject';

export type ContractPendingCustomerAction = {
  label: string;
  description?: string;
  variant?: ContractPendingCustomerActionVariant;
  inputSchema?: unknown;
  inputRequired?: boolean;
  inputTitle?: string;
  inputPlaceholder?: string;
};

type ContractPendingActionBase = {
  actionId: string;
  status: ContractPendingActionStatus;
  title: string;
  requestId?: string;
  minSummaryEpoch?: number;
  queueOrder?: number;
  createdAt: string;
  decidedAt?: string;
};

export type MonitoringContractPendingAction = ContractPendingActionBase & {
  type: 'monitoringConsentApproval';
  summary?: string;
  targetMerchantId?: string;
  requestedEvents?: string[];
  payload?: Record<string, unknown>;
};

export type PaymentMandateBootstrapContractPendingAction =
  ContractPendingActionBase & {
    type: 'paymentMandateBootstrapApproval';
    summary?: string;
    payload?: Record<string, unknown>;
  };

export type CustomerContractPendingAction = ContractPendingActionBase & {
  type: 'customerActionOptions' | 'customerActionInput';
  summary?: string;
  message: string;
  actions: ContractPendingCustomerAction[];
  payload?: Record<string, unknown>;
  decisionPayload?: {
    actionLabel?: string;
    input?: unknown;
  };
};

export type ContractPendingAction =
  | MonitoringContractPendingAction
  | PaymentMandateBootstrapContractPendingAction
  | CustomerContractPendingAction;

export type ContractMonitoringSubscriptionStatus =
  | 'pending'
  | 'active'
  | 'rejected';

export type ContractMonitoringSubscription = {
  subscriptionId: string;
  targetMerchantId: string;
  requestedEvents: string[];
  status: ContractMonitoringSubscriptionStatus;
  pendingActionId?: string;
  requestId?: string;
  requestEventId: string;
  requestEventIndex: number;
  reportedTransactionIds?: string[];
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  rejectedAt?: string;
};

export type ContractDocumentSummaryStory = {
  headline: string;
  overview: string[];
  bullets: string[];
};

export type ContractDocumentSummaryNextSteps = {
  title: string;
  items: string[];
};

export type ContractDocumentSummaryLastChange = {
  short: string;
  more: string;
};

export type ContractDocumentSummary = {
  story: ContractDocumentSummaryStory;
  listPreview: string;
  nextSteps: ContractDocumentSummaryNextSteps;
  lastChange: ContractDocumentSummaryLastChange;
};

export type ContractHistoryKind =
  | 'contractUpdated'
  | 'pendingActionRequested'
  | 'bankLifecycle';

export type ContractHistoryEntry = {
  id: string;
  contractId: string;
  kind: ContractHistoryKind;
  short: string;
  more?: string;
  createdAt: string;
};

export type ContractHistoryEntryInput = Omit<
  ContractHistoryEntry,
  'id' | 'createdAt'
> & {
  id?: string;
  createdAt?: string;
};

export type ContractSummaryUpdate = {
  contractId: string;
  summarySourceUpdatedAt: string;
  summarySourceEpoch: number;
  summary?: ContractDocumentSummary | null;
  summaryPreview?: string | null;
  summaryUpdatedAt?: string | null;
  summaryInputBlueId?: string | null;
  summaryModel?: string | null;
  summaryError?: string | null;
  summaryDocument?: Record<string, unknown> | null;
  summaryDocumentName?: string | null;
  summaryStatus?: string | null;
  summaryStatusUpdatedAt?: string | null;
  summaryStatusTimestamps?: ContractStatusTimestamps | null;
  summaryTriggerEvent?: unknown | null;
  summaryEmittedEvents?: unknown[] | null;
  userId?: string | null;
  relatedTransactionIds?: string[] | null;
  relatedHoldIds?: string[] | null;
};

export type ContractSummarySnapshot = {
  contractId: string;
  summaryDocument?: Record<string, unknown> | null;
  summaryStatus?: string | null;
  summaryStatusUpdatedAt?: string | null;
  summaryStatusTimestamps?: ContractStatusTimestamps | null;
  summaryTriggerEvent?: unknown | null;
  summaryEmittedEvents?: unknown[] | null;
  summarySourceUpdatedAt?: string | null;
  summarySourceEpoch?: number | null;
  summaryUpdatedAt?: string | null;
  summaryInputBlueId?: string | null;
};

export type ContractArchiveUpdate = {
  contractId: string;
  archivedAt: string | null;
  updatedAt: string;
  userId?: string | null;
  relatedTransactionIds?: string[] | null;
  relatedHoldIds?: string[] | null;
};

export interface ContractRecord {
  contractId: string;
  typeBlueId: string;
  displayName: string;
  documentName?: string;
  customerChannelKey?: string;
  sessionId?: string;
  documentId?: string;
  document?: Record<string, unknown>;
  status?: string;
  archivedAt?: string;
  statusUpdatedAt?: string;
  statusTimestamps?: ContractStatusTimestamps;
  triggerEvent?: unknown;
  emittedEvents?: unknown[];
  relatedTransactionIds?: string[];
  relatedHoldIds?: string[];
  accountNumber?: string;
  userId?: string;
  merchantId?: string;
  summary?: ContractDocumentSummary;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  summarySourceEpoch?: number;
  summaryInputBlueId?: string;
  summaryModel?: string;
  summaryError?: string;
  summaryPreview?: string;
  summaryDocument?: Record<string, unknown>;
  summaryDocumentName?: string;
  summaryStatus?: string;
  summaryStatusUpdatedAt?: string;
  summaryStatusTimestamps?: ContractStatusTimestamps;
  summaryTriggerEvent?: unknown;
  summaryEmittedEvents?: unknown[];
  pendingActions?: ContractPendingAction[];
  monitoringSubscriptions?: ContractMonitoringSubscription[];
  createdAt: string;
  updatedAt: string;
}

export interface ContractSummary {
  contractId: string;
  typeBlueId: string;
  displayName: string;
  documentName?: string;
  customerChannelKey?: string;
  sessionId?: string;
  documentId?: string;
  status?: string;
  hasPendingAction?: boolean;
  archivedAt?: string;
  merchantId?: string;
  summaryPreview?: string;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  summarySourceEpoch?: number;
  updatedAt: string;
  createdAt: string;
}

export interface ContractRepository {
  getContract(contractId: string): Promise<ContractRecord | null>;
  getContractBySessionId(sessionId: string): Promise<ContractRecord | null>;
  getContractByDocumentId(documentId: string): Promise<ContractRecord | null>;
  claimCanonicalSessionByDocumentId?(input: {
    documentId: string;
    sessionId: string;
    createdAt: string;
  }): Promise<{
    canonicalContractId: string;
    isCanonicalOwner: boolean;
  }>;
  linkSessionToContract?(input: {
    sessionId: string;
    contractId: string;
    createdAt: string;
  }): Promise<void>;
  getContractSummarySnapshot(
    contractId: string
  ): Promise<ContractSummarySnapshot | null>;
  saveContract(record: ContractRecord): Promise<void>;
  saveContractSummarySnapshot(snapshot: ContractSummarySnapshot): Promise<void>;
  markSummaryEventProcessed(eventId: string): Promise<boolean>;
  addContractHistoryEntry(
    entry: ContractHistoryEntryInput
  ): Promise<ContractHistoryEntry>;
  listContractHistory(contractId: string): Promise<ContractHistoryEntry[]>;
  updateContractArchive(update: ContractArchiveUpdate): Promise<void>;
  updateContractSummary(update: ContractSummaryUpdate): Promise<void>;
  listContractsByUserId(
    userId: string,
    options?: { updatedSince?: string }
  ): Promise<ContractSummary[]>;
  listContractsByTransactionId(
    transactionId: string,
    options?: { userId?: string }
  ): Promise<ContractSummary[]>;
  listContractsByHoldId(
    holdId: string,
    options?: { userId?: string }
  ): Promise<ContractSummary[]>;
}
