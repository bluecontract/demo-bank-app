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

// Card types
export type IssueCardResponse = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['issueCard'],
  201
>;

export type CardListResponse = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['listCards'],
  200
>;

export type CardSummary = CardListResponse['cards'][number];

export type CardDetailsResponse = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['getCard'],
  200
>;

export type CardDetails = CardDetailsResponse;

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

export type TransactionDetails = Transaction;

export type ActivityFeed = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['listActivity'],
  200
>;

export type ActivityFeedItem = ActivityFeed['items'][number];

// PayNote Delivery types
export type PayNoteDeliveryList = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['listPayNoteDeliveries'],
  200
>;

export type PayNoteDeliverySummary = PayNoteDeliveryList['items'][number];

export type PayNoteDeliveryDetails = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['getPayNoteDelivery'],
  200
>;

// Contract types
export type ContractListResponse = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['listContracts'],
  200
>;

export type ContractSummary = ContractListResponse['items'][number];

export type ContractDetails = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['getContractDetails'],
  200
>;

export type ContractOperationResponse = ClientInferResponseBody<
  (typeof bankApiContract)['banking']['runContractOperation'],
  200
>;

// Re-export commonly used types
export type { Transaction as TransactionItem };
