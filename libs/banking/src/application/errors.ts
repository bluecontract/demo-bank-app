import { AppError } from '@demo-blue/shared-core';

export class AccountNotFoundError extends AppError {
  override readonly code = 'ACCOUNT_NOT_FOUND';

  constructor(accountId: string, cause?: Error) {
    super(`Account ${accountId} not found`, { cause });
  }
}
