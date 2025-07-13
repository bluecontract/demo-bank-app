import { TsRestResponse } from '@ts-rest/serverless/aws';
import type { Logger } from '@demo-blue/shared-observability';
import { ERROR_CODES, toUnauthorizedResponse } from './shared/errors';
import { ValidationError } from '@demo-blue/shared-core';
import { UnauthorizedRequestError } from './auth/errors';

const toValidationError = (error: unknown) => {
  const isRequestValidationError =
    (error as { name: string })?.name === 'RequestValidationError';

  let errors: string | undefined;

  if (isRequestValidationError) {
    const body = (error as { body: Record<string, unknown> }).body || {};
    const extractIssues = (errObj: { issues: unknown[] } | null) =>
      errObj && Array.isArray(errObj?.issues) ? errObj?.issues : null;
    const validationErrors = {
      pathParameterErrors: extractIssues(
        body.pathParameterErrors as { issues: unknown[] } | null
      ),
      headerErrors: extractIssues(
        body.headerErrors as { issues: unknown[] } | null
      ),
      queryParameterErrors: extractIssues(
        body.queryParameterErrors as { issues: unknown[] } | null
      ),
      bodyErrors: extractIssues(
        body.bodyErrors as { issues: unknown[] } | null
      ),
    };
    errors = JSON.stringify(validationErrors);
  }

  return TsRestResponse.fromJson(
    {
      error: ERROR_CODES.VALIDATION_ERROR,
      message: (error as { message: string })?.message,
      errors,
    },
    { status: 400 as const }
  );
};

const toUnauthorizedError = () => {
  return TsRestResponse.fromJson(
    { error: ERROR_CODES.UNAUTHORIZED, message: 'Unauthorized' },
    { status: 401 as const }
  );
};

const toInternalServerError = () => {
  return TsRestResponse.fromJson(
    { error: ERROR_CODES.INTERNAL_ERROR, message: 'Internal server error' },
    { status: 500 as const }
  );
};

export const createErrorHandler = (logger: Logger) => {
  return (error: unknown) => {
    if (
      error instanceof ValidationError ||
      (error as { name: string })?.name === 'RequestValidationError'
    ) {
      logger.info('Validation error', {
        error: String(error),
        stack: (error as Error)?.stack,
      });
      return toValidationError(error);
    }

    if (error instanceof UnauthorizedRequestError) {
      logger.error('Unauthorized request error', {
        error: String(error),
        stack: (error as Error)?.stack,
      });
      return toUnauthorizedError();
    }

    logger.error('Internal server error', {
      error: String(error),
      stack: (error as Error)?.stack,
    });
    return toInternalServerError();
  };
};
