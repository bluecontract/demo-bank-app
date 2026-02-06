import { AppError } from '@demo-bank-app/shared-core';

export class TokenGenerationError extends AppError {
  readonly code = 'TOKEN_GENERATION_ERROR';

  constructor(userId: string, cause?: Error) {
    super(`Failed to generate token for user '${userId}'`, { cause });
  }
}

export class TokenVerificationError extends AppError {
  readonly code = 'TOKEN_VERIFICATION_ERROR';

  constructor(message: string, cause?: Error) {
    super(`Token verification failed: ${message}`, { cause });
  }
}

export class TokenExpiredError extends AppError {
  readonly code = 'TOKEN_EXPIRED';

  constructor(cause?: Error) {
    super('Token has expired', { cause });
  }
}

export class TokenServiceError extends AppError {
  readonly code = 'TOKEN_SERVICE_ERROR';

  constructor(operation: string, cause?: Error) {
    super(`Token service operation failed: ${operation}`, { cause });
  }
}

export class UserAlreadyExistsError extends AppError {
  readonly code = 'USER_ALREADY_EXISTS';

  constructor(email: string, cause?: Error) {
    super(`User with email '${email}' already exists`, { cause });
  }
}

export class UserNotFoundError extends AppError {
  readonly code = 'USER_NOT_FOUND';

  constructor(email: string, cause?: Error) {
    super(`User with email '${email}' not found`, { cause });
  }
}

export class AuthRepositoryError extends AppError {
  readonly code = 'AUTH_REPOSITORY_ERROR';

  constructor(operation: string, cause?: Error) {
    super(`Authentication repository operation failed: ${operation}`, {
      cause,
    });
  }
}

export class MerchantDirectoryOwnershipError extends AppError {
  readonly code = 'MERCHANT_DIRECTORY_OWNERSHIP_ERROR';

  constructor(merchantId: string, cause?: Error) {
    super(`Merchant '${merchantId}' is owned by another user`, { cause });
  }
}
