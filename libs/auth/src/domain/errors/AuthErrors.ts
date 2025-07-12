import { AppError } from '@demo-blue/shared-core';

export class InvalidUserNameError extends AppError {
  readonly code = 'INVALID_USER_NAME';

  constructor(name: string, reason: string, cause?: Error) {
    super(`Invalid user name '${name}': ${reason}`, { cause });
  }
}

export class UserAlreadyExistsError extends AppError {
  readonly code = 'USER_ALREADY_EXISTS';

  constructor(name: string, cause?: Error) {
    super(`User with name '${name}' already exists`, { cause });
  }
}

export class UserNotFoundError extends AppError {
  readonly code = 'USER_NOT_FOUND';

  constructor(name: string, cause?: Error) {
    super(`User with name '${name}' not found`, { cause });
  }
}

export class InvalidTokenError extends AppError {
  readonly code = 'INVALID_TOKEN';

  constructor(reason: string, cause?: Error) {
    super(`Invalid token: ${reason}`, { cause });
  }
}

export class TokenExpiredError extends AppError {
  readonly code = 'TOKEN_EXPIRED';

  constructor(cause?: Error) {
    super('Token has expired', { cause });
  }
}
