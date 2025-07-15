import { AppError } from '@demo-blue/shared-core';

export class ConfigurationValidationError extends AppError {
  readonly code = 'CONFIGURATION_VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly missingVariables: string[],
    cause?: Error
  ) {
    super(message, { cause });
  }
}

export class ConfigurationError extends AppError {
  readonly code = 'CONFIGURATION_ERROR';

  constructor(message: string, cause?: Error) {
    super(message, { cause });
  }
}
