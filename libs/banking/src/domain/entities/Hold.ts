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
}

export type HoldEvent =
  | {
      at: string;
      type: 'CREATED';
      createdByUserId?: string;
      idempotencyKeyHash?: string;
    }
  | {
      at: string;
      type: 'CAPTURED';
      transactionId: string;
      counterpartyAccountNumber: string;
    }
  | {
      at: string;
      type: 'RELEASED';
      reason?: string;
    }
  | {
      at: string;
      type: 'FAILED';
      code: HoldFailedCode;
      message?: string;
    };
