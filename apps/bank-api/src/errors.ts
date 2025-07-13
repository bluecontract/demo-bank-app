import { TsRestResponse } from '@ts-rest/serverless/aws';
import { UserValidationError } from '@demo-blue/auth';
import type { Logger } from '@demo-blue/shared-observability';
import { ERROR_CODES } from './shared/errors';

export const toValidationError = (error: unknown) => {
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

export const toInternalServerError = () => {
  return TsRestResponse.fromJson(
    { error: ERROR_CODES.INTERNAL_ERROR, message: 'Internal server error' },
    { status: 500 as const }
  );
};

export const createErrorHandler = (logger: Logger) => {
  return (error: unknown) => {
    if (
      error instanceof UserValidationError ||
      (error as { name: string })?.name === 'RequestValidationError'
    ) {
      return toValidationError(error);
    }

    logger.error('Internal server error', {
      error: String(error),
      stack: (error as Error)?.stack,
    });
    return toInternalServerError();
  };
};
