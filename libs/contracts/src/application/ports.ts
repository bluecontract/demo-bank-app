export type ContractStatusTimestamps = Record<string, string>;

export type ContractDocumentSummaryKeyFact = {
  label: string;
  value: string;
};

export type ContractDocumentSummaryState = {
  statusLabel: string;
  explanation: string;
  updatedAt: string | null;
};

export type ContractDocumentSummary = {
  title: string;
  oneLiner: string;
  state: ContractDocumentSummaryState;
  keyFacts: ContractDocumentSummaryKeyFact[];
  warnings: string[];
};

export type ContractSummaryUpdate = {
  contractId: string;
  summary?: ContractDocumentSummary | null;
  summaryUpdatedAt?: string | null;
  summarySourceUpdatedAt?: string | null;
  summaryInputBlueId?: string | null;
  summaryModel?: string | null;
  summaryError?: string | null;
  userId?: string | null;
  relatedTransactionIds?: string[] | null;
  relatedHoldIds?: string[] | null;
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
  summary?: ContractDocumentSummary;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  summaryInputBlueId?: string;
  summaryModel?: string;
  summaryError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContractSummary {
  contractId: string;
  typeBlueId: string;
  displayName: string;
  documentName?: string;
  sessionId?: string;
  documentId?: string;
  status?: string;
  archivedAt?: string;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  updatedAt: string;
  createdAt: string;
}

export interface ContractRepository {
  getContract(contractId: string): Promise<ContractRecord | null>;
  getContractBySessionId(sessionId: string): Promise<ContractRecord | null>;
  getContractByDocumentId(documentId: string): Promise<ContractRecord | null>;
  saveContract(record: ContractRecord): Promise<void>;
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
