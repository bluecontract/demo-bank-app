import { ProblemDto } from '@demo-blue/shared-bank-api-contract';

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  MISSING_IDEMPOTENCY_KEY: 'MISSING_IDEMPOTENCY_KEY',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  TRANSACTION_NOT_FOUND: 'TRANSACTION_NOT_FOUND',
  PAYNOTE_PARSE_FAILED: 'PAYNOTE_PARSE_FAILED',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  PAYNOTE_NOT_VERIFIED: 'PAYNOTE_NOT_VERIFIED',
} as const;

type StatusCode = 400 | 401 | 403 | 404 | 409 | 500;
interface ProblemResponseOptions {
  status: StatusCode;
  code: ProblemDto['error'];
  message: ProblemDto['message'];
  detail?: ProblemDto['detail'];
}

export const problemResponse = ({
  status,
  code,
  message,
  detail,
}: ProblemResponseOptions): {
  body: ProblemDto;
  status: StatusCode;
} => {
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
