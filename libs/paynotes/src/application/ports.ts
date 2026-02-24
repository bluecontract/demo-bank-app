export interface PayNoteVerificationRecord {
  userId: string;
  blueId: string;
  validationScore: number;
  explanation: string;
  isSuccessful: boolean;
  validatedAt: string;
  ttl?: number;
}

export interface SavePayNoteVerificationInput {
  userId: string;
  blueId: string;
  validationScore: number;
  explanation: string;
  isSuccessful: boolean;
  validatedAt: string;
  ttl?: number;
}

export interface PayNoteVerificationRepository {
  saveVerification(input: SavePayNoteVerificationInput): Promise<void>;
  getVerification(params: {
    userId: string;
    blueId: string;
  }): Promise<PayNoteVerificationRecord | null>;
}

export interface BlueIdCalculator {
  fromYaml(yamlContent: string): string;
  fromObject(payload: Record<string, unknown>): string;
  toReversedJson(payload: unknown): unknown;
}

export type LogLevel = 'info' | 'error' | 'warn';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export interface MyOsCredentials {
  apiKey: string;
  accountId: string;
  baseUrl: string;
}

export interface MyOsBootstrapPayload {
  channelBindings: Record<string, { email?: string; accountId?: string }>;
  document: Record<string, unknown>;
}

export interface MyOsBootstrapResponse {
  ok: boolean;
  status: number;
  body?: unknown;
}

export interface MyOsOperationResponse {
  ok: boolean;
  status: number;
  body?: unknown;
}

export type MyOsFetchEventResult =
  | { kind: 'success'; payload: unknown }
  | { kind: 'not-found'; status: number; detail?: string }
  | {
      kind: 'http-error';
      status: number;
      statusText?: string;
      detail?: string;
    }
  | {
      kind: 'parse-error';
      status: number;
      error: unknown;
    }
  | { kind: 'network-error'; error: unknown };

export type MyOsFetchDocumentResult =
  | {
      kind: 'success';
      document: {
        documentId: string;
        sessionId: string;
        document?: Record<string, unknown>;
      };
    }
  | { kind: 'not-found'; status: number; detail?: string }
  | {
      kind: 'http-error';
      status: number;
      statusText?: string;
      detail?: string;
    }
  | {
      kind: 'parse-error';
      status: number;
      error: unknown;
    }
  | { kind: 'network-error'; error: unknown };

export interface MyOsClient {
  /**
   * Resolves credentials that allow the caller to interact with the MyOS APIs.
   */
  getCredentials(): Promise<MyOsCredentials>;

  bootstrapDocument(input: {
    credentials: MyOsCredentials;
    payload: MyOsBootstrapPayload;
    idempotencyKey?: string;
  }): Promise<MyOsBootstrapResponse>;

  runDocumentOperation(input: {
    credentials: MyOsCredentials;
    sessionId: string;
    operation: string;
    payload?: unknown;
  }): Promise<MyOsOperationResponse>;

  fetchEvent(eventId: string): Promise<MyOsFetchEventResult>;

  fetchDocument(sessionId: string): Promise<MyOsFetchDocumentResult>;
}

export interface PayNoteDeliveryRecord {
  deliveryId: string;
  deliveryDocumentId?: string;
  deliverySessionId?: string;
  deliverySessionIds?: string[];
  deliveryEpoch?: number;
  synchronySessionId?: string;
  cardTransactionDetails?: CardTransactionDetails;
  cardTransactionDetailsKey?: string;
  accountNumber?: string;
  userId?: string;
  holdId?: string;
  transactionId?: string;
  merchantId?: string;
  transactionIdentificationStatus?: string;
  clientDecisionStatus?: string;
  deliveryStatus?: string;
  deliveryDocument?: Record<string, unknown>;
  deliveryUpdatedAt?: string;
  payNoteDocumentId?: string;
  payNoteSessionIds?: string[];
  payNoteBootstrapSessionId?: string;
  payNoteDocument?: Record<string, unknown>;
  payNoteUpdatedAt?: string;
  identificationReportedAt?: string;
  decisionRecordedAt?: string;
  payNoteBootstrapRequestedAt?: string;
  paymentMandateDocumentId?: string;
  paymentMandateBootstrapSessionId?: string;
  paymentMandateStatus?: 'not_required' | 'pending' | 'attached' | 'failed';
  summary?: Record<string, unknown>;
  summaryUpdatedAt?: string;
  summarySourceUpdatedAt?: string;
  summarySourceEpoch?: number;
  summaryInputBlueId?: string;
  summaryModel?: string;
  summaryError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayNoteDeliverySummary {
  deliveryId: string;
  deliverySessionId?: string;
  payNoteSessionIds?: string[];
  payNoteDocumentId?: string;
  name?: string;
  proposalDescription?: string;
  amountMinor?: number;
  currency?: string;
  merchantId?: string;
  summaryPreview?: string;
  deliveryStatus?: string;
  transactionIdentificationStatus?: string;
  clientDecisionStatus?: string;
  transactionId?: string;
  holdId?: string;
  paymentMandateDocumentId?: string;
  paymentMandateStatus?: 'not_required' | 'pending' | 'attached' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface PayNoteDeliveryRepository {
  markEventProcessed(eventId: string): Promise<boolean>;
  finalizeEventProcessing?(eventId: string): Promise<void>;
  releaseEventProcessing?(eventId: string): Promise<void>;
  getDelivery(deliveryId: string): Promise<PayNoteDeliveryRecord | null>;
  getDeliveryByDocumentId(
    documentId: string
  ): Promise<PayNoteDeliveryRecord | null>;
  getDeliveryBySessionId(
    sessionId: string
  ): Promise<PayNoteDeliveryRecord | null>;
  getDeliveryByBootstrapSessionId(
    sessionId: string
  ): Promise<PayNoteDeliveryRecord | null>;
  getDeliveryByPayNoteDocumentId(
    documentId: string
  ): Promise<PayNoteDeliveryRecord | null>;
  getDeliveryByCardTransactionDetails(
    details: CardTransactionDetails
  ): Promise<PayNoteDeliveryRecord | null>;
  saveDelivery(record: PayNoteDeliveryRecord): Promise<void>;
  updateDeliverySummary(input: {
    deliveryId: string;
    summary?: Record<string, unknown>;
    summaryUpdatedAt?: string;
    summarySourceUpdatedAt?: string;
    summarySourceEpoch?: number;
    summaryInputBlueId?: string;
    summaryModel?: string;
    summaryError?: string | null;
  }): Promise<void>;
  listDeliveriesByUserId(userId: string): Promise<PayNoteDeliverySummary[]>;
}

export interface PayNoteRecord {
  payNoteDocumentId: string;
  sessionIds?: string[];
  deliveryId?: string;
  accountNumber?: string;
  userId?: string;
  holdId?: string;
  transactionId?: string;
  merchantId?: string;
  lastSourceEventCreatedAt?: string;
  lastCaptureLockEventId?: string;
  lastCaptureUnlockEventId?: string;
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
  document?: Record<string, unknown>;
  transactionRequest?: unknown;
  triggerEvent?: unknown;
  pendingMandateChargeAttempts?: Record<
    string,
    {
      mandateDocumentId: string;
      eventType: string;
      requestId?: string;
      queuedAt: string;
      retryCount: number;
      nextRetryAt?: string;
      lastReason?: string;
    }
  >;
  transferMandateAttemptsByHoldId?: Record<
    string,
    {
      mandateDocumentId: string;
      mandateSessionId: string;
      chargeAttemptId: string;
      updatedAt: string;
    }
  >;
  createdAt: string;
  updatedAt: string;
}

export interface PayNoteRepository {
  getPayNote(documentId: string): Promise<PayNoteRecord | null>;
  getPayNoteBySessionId(sessionId: string): Promise<PayNoteRecord | null>;
  savePayNote(record: PayNoteRecord): Promise<void>;
  markEventProcessed(eventId: string): Promise<boolean>;
}

export interface PayNoteBootstrapRecord {
  bootstrapSessionId: string;
  userId: string;
  accountNumber: string;
  payerAccountNumber: string;
  payeeAccountNumber?: string;
  createdAt: string;
}

export interface PayNoteBootstrapRepository {
  getBootstrapBySessionId(
    bootstrapSessionId: string
  ): Promise<PayNoteBootstrapRecord | null>;
  saveBootstrap(record: PayNoteBootstrapRecord): Promise<void>;
}

export interface BootstrapContextRecord {
  bootstrapSessionId: string;
  merchantId?: string;
  accountNumber?: string;
  userId?: string;
  holdId?: string;
  transactionId?: string;
  payerAccountNumber?: string;
  payeeAccountNumber?: string;
  customerChannelKey?: string;
  requestingSessionId?: string;
  requestId?: string;
  createdAt: string;
}

export interface BootstrapContextRepository {
  getContextBySessionId(
    bootstrapSessionId: string
  ): Promise<BootstrapContextRecord | null>;
  saveContext(record: BootstrapContextRecord): Promise<void>;
}

export interface PendingBootstrapEventRecord {
  bootstrapSessionId: string;
  eventId: string;
  createdAt: string;
  ttl?: number;
}

export interface PendingBootstrapEventRepository {
  addPending(record: PendingBootstrapEventRecord): Promise<void>;
  listPending(
    bootstrapSessionId: string
  ): Promise<PendingBootstrapEventRecord[]>;
  deletePending(input: {
    bootstrapSessionId: string;
    eventId: string;
  }): Promise<void>;
}

export interface BankingAccount {
  id: string;
  accountNumber: string;
  ownerUserId?: string;
}

export interface TransferFundsRequest {
  sourceAccountId: string;
  destinationAccountNumber: string;
  amountMinor: number;
  description: string;
  userId: string;
  idempotencyKey: string;
  payNoteDocumentId?: string;
}

export interface ReserveFundsRequest {
  holdId?: string;
  payerAccountNumber: string;
  amountMinor: number;
  description?: string;
  counterpartyAccountNumber?: string;
  payNoteDocumentId?: string;
  userId: string;
  idempotencyKey: string;
}

export interface CaptureHoldRequest {
  holdId: string;
  userId: string;
  idempotencyKey: string;
  amountMinor?: number;
  counterpartyAccountNumber?: string;
  payNoteDocumentId?: string;
}

export interface BankingFacade {
  /**
   * Resolves account details associated with the provided account number.
   */
  getAccountByNumber(accountNumber: string): Promise<BankingAccount | null>;

  /**
   * Resolves an account owned by the provided user.
   * Returns null when the account could not be found or is not owned by the user.
   */
  getAccountForUser(
    accountNumber: string,
    userId: string
  ): Promise<BankingAccount | null>;

  /**
   * Resolves an active merchant credit line account when available.
   */
  getActiveCreditLineAccountByMerchantId?(
    merchantId: string
  ): Promise<BankingAccount | null>;

  /**
   * Transfers funds between two bank accounts.
   */
  transferFunds(request: TransferFundsRequest): Promise<void>;

  /**
   * Reserves funds on behalf of a user and returns the generated hold identifier.
   */
  reserveFunds(request: ReserveFundsRequest): Promise<void>;

  /**
   * Captures a previously reserved hold.
   */
  captureHold(request: CaptureHoldRequest): Promise<Hold>;
}

export interface ClockPort {
  now(): Date;
}

export interface IdGeneratorPort {
  generate(): string;
}

export interface PayNoteValidationFormData {
  fromAccount?: string;
  toAccount?: string;
  recipientName?: string;
  totalAmount?: string;
  title?: string;
}

export interface PayNoteValidationProvider {
  validate(input: {
    yamlContent: string;
    formData: PayNoteValidationFormData;
  }): Promise<{
    validationScore: number;
    explanation: string;
  }>;
}
import type { CardTransactionDetails, Hold } from '@demo-bank-app/banking';
