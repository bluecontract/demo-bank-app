import type { Hold, HoldEvent } from '../domain/entities/Hold';
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

/**
 * Repository interface for Hold persistence.
 * Implementations are responsible for storing hold metadata,
 * appending hold lifecycle events, and querying relevant records.
 */
export interface HoldRepository {
  putHoldMeta(hold: Hold): Promise<void>;
  appendHoldEvent(holdId: Hold['holdId'], event: HoldEvent): Promise<void>;
  getHold(holdId: Hold['holdId']): Promise<Hold | null>;
  listPendingHoldsByAccountNumber(
    accountNumber: Hold['payerAccountNumber'],
    options?: PaginationOptions
  ): Promise<PaginatedResult<Hold>>;
  reserveHold(request: ReserveHoldRequest): Promise<ReserveHoldResult>;
}
