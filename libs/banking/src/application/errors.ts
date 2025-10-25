import { AppError } from '@demo-bank-app/shared-core';

export class AccountNotFoundError extends AppError {
  override readonly code = 'ACCOUNT_NOT_FOUND';

  constructor(accountId: string, cause?: Error) {
    super(`Account ${accountId} not found`, { cause });
  }
}

export class InvalidActivityCursorError extends AppError {
  override readonly code = 'INVALID_CURSOR';

  constructor(message = 'Invalid activity cursor') {
    super(message);
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

export class HoldCounterpartyMismatchError extends AppError {
  readonly code = 'HOLD_COUNTERPARTY_MISMATCH';

  constructor(holdId: string, expected: string, received: string | undefined) {
    super(
      `Hold ${holdId} counterparty mismatch (expected ${expected}, received ${
        received ?? 'undefined'
      })`
    );
  }
}

export class HoldCounterpartyRequiredError extends AppError {
  readonly code = 'HOLD_COUNTERPARTY_REQUIRED';

  constructor(holdId: string) {
    super(`Hold ${holdId} capture requires a counterparty account number`);
  }
}
