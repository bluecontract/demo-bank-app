import type { Hold, HoldEvent } from '../domain/entities/Hold';
import type { PaginationOptions, PaginatedResult } from '../domain/types';

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
}
