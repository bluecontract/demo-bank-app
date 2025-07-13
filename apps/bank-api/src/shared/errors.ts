import { ProblemDto } from '@demo-blue/shared-bank-api-contract';

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export const problemResponse = ({
  status,
  code,
  message,
  detail,
}: ProblemDto & { status: 401 | 404 | 409 | 500 }) => {
  return {
    status,
    body: { error: code, message, detail },
  };
};

export const toUnauthorizedResponse = (message: string) => {
  return problemResponse({
    status: 401 as const,
    code: ERROR_CODES.UNAUTHORIZED,
    message,
  });
};
