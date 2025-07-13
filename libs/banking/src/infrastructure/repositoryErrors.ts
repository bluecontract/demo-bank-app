import { AppError } from '@demo-blue/shared-core';

export class RepositoryError extends AppError {
  readonly code: string = 'REPOSITORY_ERROR';

  constructor(operation: string, cause?: Error) {
    super(`Repository operation failed: ${operation}`, { cause });
  }
}

export class OptimisticLockError extends RepositoryError {
  override readonly code = 'OPTIMISTIC_LOCK_ERROR';

  constructor(resourceId: string, cause?: Error) {
    super(`Optimistic lock failed for ${resourceId}`, cause);
  }
}

export class TransactionIdempotencyRecordNotFoundError extends RepositoryError {
  override readonly code = 'TRANSACTION_IDEMPOTENCY_RECORD_NOT_FOUND';

  constructor(idempotencyKey: string, cause?: Error) {
    super(
      `Transaction idempotency record not found for key: ${idempotencyKey}`,
      cause
    );
  }
}
