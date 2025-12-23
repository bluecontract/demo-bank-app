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

export interface MyOsClient {
  /**
   * Resolves credentials that allow the caller to interact with the MyOS APIs.
   */
  getCredentials(): Promise<MyOsCredentials>;

  bootstrapDocument(input: {
    credentials: MyOsCredentials;
    payload: MyOsBootstrapPayload;
  }): Promise<MyOsBootstrapResponse>;

  fetchEvent(eventId: string): Promise<MyOsFetchEventResult>;
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
  payNoteEventId?: string;
}

export interface ReserveFundsRequest {
  holdId?: string;
  payerAccountNumber: string;
  amountMinor: number;
  description?: string;
  counterpartyAccountNumber?: string;
  payNoteEventId?: string;
  userId: string;
  idempotencyKey: string;
}

export interface CaptureHoldRequest {
  holdId: string;
  userId: string;
  idempotencyKey: string;
  counterpartyAccountNumber?: string;
  payNoteEventId?: string;
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
  captureHold(request: CaptureHoldRequest): Promise<void>;
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
