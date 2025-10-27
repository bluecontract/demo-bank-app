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

export interface MyOsCredentials {
  apiKey: string;
  accountId: string;
  baseUrl: string;
}

export interface MyOsClient {
  /**
   * Resolves credentials that allow the caller to interact with the MyOS APIs.
   */
  getCredentials(): Promise<MyOsCredentials>;
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
  reserveFunds(request: ReserveFundsRequest): Promise<string>;

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
