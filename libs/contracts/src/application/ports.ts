export type ContractStatusTimestamps = Record<string, string>;

export interface ContractRecord {
  contractId: string;
  typeBlueId: string;
  displayName: string;
  documentName?: string;
  sessionId?: string;
  documentId?: string;
  document?: Record<string, unknown>;
  status?: string;
  statusUpdatedAt?: string;
  statusTimestamps?: ContractStatusTimestamps;
  triggerEvent?: unknown;
  emittedEvents?: unknown[];
  relatedTransactionIds?: string[];
  relatedHoldIds?: string[];
  accountNumber?: string;
  userId?: string;
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
  updatedAt: string;
  createdAt: string;
}

export interface ContractRepository {
  getContract(contractId: string): Promise<ContractRecord | null>;
  getContractBySessionId(sessionId: string): Promise<ContractRecord | null>;
  getContractByDocumentId(documentId: string): Promise<ContractRecord | null>;
  saveContract(record: ContractRecord): Promise<void>;
  listContractsByUserId(
    userId: string,
    options?: { updatedSince?: string }
  ): Promise<ContractSummary[]>;
}
