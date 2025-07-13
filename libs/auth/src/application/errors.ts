import { AppError } from '@demo-blue/shared-core';

export class AuthError extends AppError {
  readonly code = 'AUTH_ERROR';

  constructor(message: string, cause?: Error) {
    super(message, { cause });
  }
}
