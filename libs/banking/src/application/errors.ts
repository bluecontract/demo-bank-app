import { AppError } from '@demo-bank-app/shared-core';

export class AccountNotFoundError extends AppError {
  override readonly code = 'ACCOUNT_NOT_FOUND';

  constructor(accountId: string, cause?: Error) {
    super(`Account ${accountId} not found`, { cause });
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';

  constructor(message: string) {
    super(message);
  }
}

export class TransactionNotFoundError extends AppError {
  readonly code = 'TRANSACTION_NOT_FOUND';

  constructor(transactionId: string) {
    super(`Transaction ${transactionId} not found`);
  }
}

export class HoldNotFoundError extends AppError {
  readonly code = 'HOLD_NOT_FOUND';

  constructor(holdId: string) {
    super(`Hold ${holdId} not found`);
  }
}

export class HoldNotPendingError extends AppError {
  readonly code = 'HOLD_NOT_PENDING';

  constructor(holdId: string, status: string) {
    super(`Hold ${holdId} is not pending (status: ${status})`);
  }
}
