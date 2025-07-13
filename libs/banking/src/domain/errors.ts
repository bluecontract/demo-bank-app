import { AppError, ValidationError } from '@demo-blue/shared-core';

export class InsufficientFundsError extends AppError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(requested: number, available: number) {
    super(`Insufficient funds: requested ${requested}, available ${available}`);
  }
}
export class UnbalancedTransactionError extends AppError {
  readonly code = 'UNBALANCED_TRANSACTION';

  constructor() {
    super('Transaction postings must be balanced');
  }
}
export class InvalidMoneyAmountError extends ValidationError {
  readonly code = 'INVALID_MONEY_AMOUNT';

  constructor(amount: number) {
    super(`Invalid money amount: ${amount}`);
  }
}

export class AccountInactiveError extends AppError {
  readonly code = 'ACCOUNT_INACTIVE';

  constructor(accountId: string) {
    super(`Account ${accountId} is inactive`);
  }
}

export class InvalidTransactionError extends ValidationError {
  readonly code = 'INVALID_TRANSACTION';

  constructor(field: string, message: string) {
    super(`Invalid transaction - ${field}: ${message}`);
  }
}

export class InvalidPostingError extends ValidationError {
  readonly code = 'INVALID_POSTING';

  constructor(field: string, message: string) {
    super(`Posting validation failed - ${field}: ${message}`);
  }
}

export class InvalidBalanceSnapshotError extends ValidationError {
  readonly code = 'INVALID_BALANCE_SNAPSHOT';
  constructor(field: string, message: string) {
    super(`Balance snapshot validation failed - ${field}: ${message}`);
  }
}

export class InvalidAccountError extends ValidationError {
  readonly code = 'INVALID_ACCOUNT';
  constructor(field: string, message: string) {
    super(`Account validation failed - ${field}: ${message}`);
  }
}
