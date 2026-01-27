/**
 * Data Transfer Objects (DTOs) for banking application layer
 * These DTOs prevent domain objects from leaking outside the application layer
 */

import { Money } from '../domain/valueObjects/Money';
import type { AccountType } from '../domain/entities/Account';

export interface AccountResult {
  id: string;
  accountNumber: string;
  name: string;
  ownerUserId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  currency: string;
  createdAt: Date;
  accountType: AccountType;
  creditLimitMinor?: Money;
  ledgerBalanceMinor: Money;
  availableBalanceMinor: Money;
  balanceVersion: number;
}

export interface PostingResult {
  accountId: string;
  amount: Money;
  side: 'DEBIT' | 'CREDIT';
  accountNumber: string;
  counterpartyAccountNumber: string;
}

export interface TransactionResult {
  id: string;
  type: 'FUNDING' | 'TRANSFER';
  status: 'POSTED';
  postings: PostingResult[];
  description: string;
  transactionIdempotencyKey?: string;
  createdAt: Date;
  cardId?: string;
  cardLast4?: string;
  merchantName?: string;
  merchantStatementDescriptor?: string;
  processorChargeId?: string;
}
