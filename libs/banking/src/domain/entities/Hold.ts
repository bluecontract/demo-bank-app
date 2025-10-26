export type HoldStatus =
  | 'PENDING'
  | 'CAPTURED'
  | 'RELEASED'
  | 'EXPIRED'
  | 'FAILED';

export type HoldFailedCode =
  | 'INSUFFICIENT_FUNDS'
  | 'STATE_MISMATCH'
  | 'VALIDATION'
  | 'INTERNAL';

export interface Hold {
  holdId: string;
  payerAccountNumber: string;
  counterpartyAccountNumber?: string;
  amountMinor: number;
  currency: 'USD';
  status: HoldStatus;
  description?: string;
  createdAt: string;
  expiresAt?: string;
  relatedTransactionId?: string;
  releasedAt?: string;
  releaseReason?: string;
  payNoteEventId?: string;
}

export type HoldEvent =
  | {
      at: string;
      type: 'CREATED';
      createdByUserId?: string;
      idempotencyKeyHash?: string;
      payNoteEventId?: string;
    }
  | {
      at: string;
      type: 'CAPTURED';
      transactionId: string;
      counterpartyAccountNumber: string;
      payNoteEventId?: string;
    }
  | {
      at: string;
      type: 'RELEASED';
      reason?: string;
      payNoteEventId?: string;
    }
  | {
      at: string;
      type: 'FAILED';
      code: HoldFailedCode;
      message?: string;
      payNoteEventId?: string;
    };
