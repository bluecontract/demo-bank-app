import { AppError } from '@demo-blue/shared-core';

export class UserValidationError extends AppError {
  readonly code = 'USER_VALIDATION_ERROR';

  constructor(field: string, message: string, cause?: Error) {
    super(`User validation failed - ${field}: ${message}`, { cause });
  }
}
