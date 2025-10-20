import { ValidationError } from '@demo-bank-app/shared-core';

export class UserValidationError extends ValidationError {
  readonly code = 'USER_VALIDATION_ERROR';

  constructor(field: string, message: string, cause?: Error) {
    super(`User validation failed - ${field}: ${message}`, { cause });
  }
}
