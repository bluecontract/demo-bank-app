import { ERROR_CODES, problemResponse } from '../shared/errors';

export const toUserAlreadyExistsError = (message: string) => {
  return problemResponse({
    status: 409 as const,
    code: ERROR_CODES.USER_ALREADY_EXISTS,
    message,
  });
};
