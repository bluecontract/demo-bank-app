import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { ClientInferResponseBody } from '@ts-rest/core';

// Health check types
export type HealthCheck = ClientInferResponseBody<
  (typeof bankApiContract)['health'],
  200
>;

// Auth types
export type User = ClientInferResponseBody<
  (typeof bankApiContract)['signUp'],
  201
>;

export type SignInResponse = ClientInferResponseBody<
  (typeof bankApiContract)['signIn'],
  200
>;

// Account types
export type Account = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['getAccount'],
  200
>;

export type AccountsList = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['listAccounts'],
  200
>;

export type CreateAccountResponse = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['createAccount'],
  201
>;

// Transfer types
export type FundAccountResponse = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['fundAccount'],
  201
>;

export type TransferMoneyResponse = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['transferMoney'],
  201
>;

// Transaction types
export type Transaction = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['getTransaction'],
  200
>;

export type TransactionsList = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['listTransactions'],
  200
>;

export type TransactionDetails = Transaction;

// Re-export commonly used types
export type { Transaction as TransactionItem };
