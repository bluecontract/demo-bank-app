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

import type { CardTransactionDetails } from '../valueObjects/CardTransactionDetails';

export interface Hold {
  holdId: string;
  payerAccountNumber: string;
  counterpartyAccountNumber?: string;
  amountMinor: number;
  currency: 'USD';
  status: HoldStatus;
  description?: string;
  cardId?: string;
  cardLast4?: string;
  merchantName?: string;
  merchantId?: string;
  merchantStatementDescriptor?: string;
  processorChargeId?: string;
  cardTransactionDetails?: CardTransactionDetails;
  captureDisabled?: boolean;
  createdAt: string;
  expiresAt?: string;
  relatedTransactionId?: string;
  releasedAt?: string;
  releaseReason?: string;
  payNoteDocumentId?: string;
}

export type HoldEvent =
  | {
      at: string;
      type: 'CREATED';
      createdByUserId?: string;
      idempotencyKeyHash?: string;
      payNoteDocumentId?: string;
    }
  | {
      at: string;
      type: 'CAPTURED';
      transactionId: string;
      counterpartyAccountNumber: string;
      payNoteDocumentId?: string;
    }
  | {
      at: string;
      type: 'RELEASED';
      reason?: string;
      payNoteDocumentId?: string;
    }
  | {
      at: string;
      type: 'FAILED';
      code: HoldFailedCode;
      message?: string;
      payNoteDocumentId?: string;
    };
