import { Account } from '../domain/entities/Account';
import { Transaction } from '../domain/entities/Transaction';
import { PaginationOptions, PaginatedResult } from '../domain/types';
import { Money } from '../domain/valueObjects/Money';
import { Posting } from '../domain/valueObjects/Posting';

export interface TransactionContext {
  userId: string;
  idempotencyKey: string;
  isTest?: boolean;
}

// Repository interface for banking data access
export interface BankingRepository {
  // Account operations
  saveAccount(account: Account): Promise<Account>;
  getAccountById(id: string): Promise<Account | null>;
  getAccountIdByNumber(accountNumber: string): Promise<Account['id'] | null>;
  getAccountsByUserId(userId: string): Promise<Account[]>;

  // Transaction operations
  saveTransactionWithAccounts(
    transaction: Transaction,
    accounts: Account[],
    context: TransactionContext
  ): Promise<Transaction['id']>;
  getTransactionsByAccount(
    accountId: string,
    options?: PaginationOptions
  ): Promise<PaginatedResult<TransactionSummary>>; // Internal feed query used by activity aggregation
  getTransactionById(transactionId: string): Promise<Transaction | null>;
}

// Account number generation interface
export interface AccountNumberGenerator {
  generate(): string;
}

// Transaction summary for account history
export interface TransactionSummary {
  transactionId: Transaction['id'];
  type: Transaction['type'];
  status: Transaction['status'];
  amount: Money;
  side: Posting['side'];
  description: Transaction['description'];
  counterpartyAccountNumber?: Posting['counterpartyAccountNumber'];
  createdAt: Transaction['createdAt'];
  originHoldId?: Transaction['originHoldId'];
  payNoteDocumentId?: Transaction['payNoteDocumentId'];
  cardId?: Transaction['cardId'];
  cardLast4?: Transaction['cardLast4'];
  merchantName?: Transaction['merchantName'];
  merchantStatementDescriptor?: Transaction['merchantStatementDescriptor'];
  processorChargeId?: Transaction['processorChargeId'];
}
