import { AppError } from '@demo-blue/shared-core';

export class AccountNotFoundError extends AppError {
  readonly code = 'ACCOUNT_NOT_FOUND';

  constructor(accountId: string) {
    super(`Account ${accountId} not found`);
  }
}

export class AccountDataCorruptedError extends AppError {
  readonly code = 'ACCOUNT_DATA_CORRUPTED';

  constructor() {
    super('Account data is corrupted');
  }
}

export class InsufficientFundsError extends AppError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(requested: number, available: number) {
    super(`Insufficient funds: requested ${requested}, available ${available}`);
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';

  constructor(message: string) {
    super(message);
  }
}

export class InvalidTransactionError extends AppError {
  readonly code = 'INVALID_TRANSACTION';

  constructor(message: string) {
    super(`Invalid transaction: ${message}`);
  }
}

export class UnbalancedTransactionError extends AppError {
  readonly code = 'UNBALANCED_TRANSACTION';

  constructor() {
    super('Transaction postings must be balanced');
  }
}

export class InvalidMoneyAmountError extends AppError {
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

export class OptimisticLockError extends AppError {
  readonly code = 'OPTIMISTIC_LOCK_ERROR';

  constructor(resourceId: string) {
    super(`Optimistic lock failed for ${resourceId}`);
  }
}

export class TransactionNotFoundError extends AppError {
  readonly code = 'TRANSACTION_NOT_FOUND';

  constructor(transactionId: string) {
    super(`Transaction ${transactionId} not found`);
  }
}

export class TransactionIdempotencyRecordNotFoundError extends AppError {
  readonly code = 'TRANSACTION_IDEMPOTENCY_RECORD_NOT_FOUND';

  constructor(idempotencyKey: string) {
    super(
      `Transaction idempotency record not found for key: ${idempotencyKey}`
    );
  }
}
