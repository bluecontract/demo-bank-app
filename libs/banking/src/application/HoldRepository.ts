import type { Hold, HoldEvent } from '../domain/entities/Hold';
import type { Transaction } from '../domain/entities/Transaction';
import type { PaginationOptions, PaginatedResult } from '../domain/types';

export interface ReserveHoldRequest {
  accountId: string;
  accountBalanceVersion: number;
  availableBalanceMinor: number;
  amountMinor: number;
  hold: Hold;
  holdEvent: Extract<HoldEvent, { type: 'CREATED' }>;
  idempotencyKey: string;
  idempotencyKeyHash: string;
  userId: string;
}

export interface ReserveHoldResult {
  hold: Hold;
  created: boolean;
}

export interface ReleaseHoldRequest {
  accountId: string;
  accountBalanceVersion: number;
  availableBalanceMinor: number;
  amountMinor: number;
  hold: Hold;
  holdEvent: Extract<HoldEvent, { type: 'RELEASED' }>;
  idempotencyKey: string;
  idempotencyKeyHash: string;
  userId: string;
}

export interface ReleaseHoldResult {
  hold: Hold;
  created: boolean;
}

export interface PartialReleaseHoldRequest {
  accountId: string;
  accountBalanceVersion: number;
  availableBalanceMinor: number;
  releaseAmountMinor: number;
  hold: Hold;
  holdEvent: Extract<HoldEvent, { type: 'RELEASED' }>;
  expectedAmountMinor: number;
  expectedCapturedAmountMinor: number;
  idempotencyKey: string;
  idempotencyKeyHash: string;
  userId: string;
}

export interface PartialReleaseHoldResult {
  hold: Hold;
  created: boolean;
}

export interface CaptureHoldRequest {
  payerAccountId: string;
  payerAccountBalanceVersion: number;
  counterpartyAccountId: string;
  counterpartyAccountBalanceVersion: number;
  hold: Hold;
  holdEvent: Extract<HoldEvent, { type: 'CAPTURED' }>;
  transaction: Transaction;
  idempotencyKey: string;
  idempotencyKeyHash: string;
  userId: string;
}

export interface CaptureHoldResult {
  hold: Hold;
  transactionId: Transaction['id'];
  created: boolean;
}

export interface PartialCaptureHoldRequest {
  payerAccountId: string;
  payerAccountBalanceVersion: number;
  counterpartyAccountId: string;
  counterpartyAccountBalanceVersion: number;
  hold: Hold;
  holdEvent: Extract<HoldEvent, { type: 'CAPTURED' | 'CAPTURED_PARTIAL' }>;
  transaction: Transaction;
  captureAmountMinor: number;
  idempotencyKey: string;
  idempotencyKeyHash: string;
  userId: string;
}

export interface PartialCaptureHoldResult {
  hold: Hold;
  transactionId: Transaction['id'];
  created: boolean;
}

/**
 * Repository interface for Hold persistence.
 * Implementations are responsible for storing hold metadata,
 * appending hold lifecycle events, and querying relevant records.
 */
export interface HoldActivityRecord {
  holdId: Hold['holdId'];
  payerAccountNumber: Hold['payerAccountNumber'];
  amountMinor: number;
  currency: Hold['currency'];
  description?: string;
  counterpartyAccountNumber?: string;
  cardId?: Hold['cardId'];
  cardLast4?: Hold['cardLast4'];
  merchantName?: Hold['merchantName'];
  merchantId?: Hold['merchantId'];
  merchantStatementDescriptor?: Hold['merchantStatementDescriptor'];
  processorChargeId?: Hold['processorChargeId'];
  eventId: string;
  event: HoldEvent;
}

export interface HoldRepository {
  putHoldMeta(hold: Hold): Promise<void>;
  appendHoldEvent(holdId: Hold['holdId'], event: HoldEvent): Promise<void>;
  getHold(holdId: Hold['holdId']): Promise<Hold | null>;
  getHoldByCardTransactionDetails(
    details: Hold['cardTransactionDetails']
  ): Promise<Hold | null>;
  ensureCardTransactionMapping(hold: Hold): Promise<void>;
  disableHoldCapture(holdId: Hold['holdId']): Promise<Hold | null>;
  enableHoldCapture(holdId: Hold['holdId']): Promise<Hold | null>;
  listHoldEvents(holdId: Hold['holdId']): Promise<HoldEvent[]>;
  listHoldActivityByAccountNumber(
    accountNumber: Hold['payerAccountNumber'],
    options?: PaginationOptions
  ): Promise<PaginatedResult<HoldActivityRecord>>;
  reserveHold(request: ReserveHoldRequest): Promise<ReserveHoldResult>;
  releaseHold(request: ReleaseHoldRequest): Promise<ReleaseHoldResult>;
  partialReleaseHold(
    request: PartialReleaseHoldRequest
  ): Promise<PartialReleaseHoldResult>;
  captureHold(request: CaptureHoldRequest): Promise<CaptureHoldResult>;
  partialCaptureHold(
    request: PartialCaptureHoldRequest
  ): Promise<PartialCaptureHoldResult>;
}
