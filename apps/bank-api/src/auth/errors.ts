import { ERROR_CODES, problemResponse } from '../shared/errors';
import { AppError } from '@demo-blue/shared-core';

export class UnauthorizedRequestError extends AppError {
  readonly code = ERROR_CODES.UNAUTHORIZED;

  constructor(message: string, cause?: Error) {
    super(message, { cause });
  }
}
export const toUserAlreadyExistsError = (message: string) => {
  return problemResponse({
    status: 409 as const,
    code: ERROR_CODES.USER_ALREADY_EXISTS,
    message,
  });
};
