import { TsRestResponse } from '@ts-rest/serverless/aws';
import { UserAlreadyExistsError } from '@demo-blue/auth';

export const ERROR_CODES = {
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export const toUserAlreadyExistsError = (error: UserAlreadyExistsError) => {
  return TsRestResponse.fromJson(
    {
      error: error.code,
      message:
        'A user with this name already exists. Please choose a different name.',
    },
    { status: 409 as const }
  );
};

export const toValidationError = (error: unknown) => {
  const isRequestValidationError =
    (error as { name: string })?.name === 'RequestValidationError';

  return TsRestResponse.fromJson(
    {
      error: ERROR_CODES.VALIDATION_ERROR,
      message: (error as { message: string })?.message,
      ...(isRequestValidationError
        ? {
            errors: {
              pathParamsError: JSON.stringify(
                (error as { pathParamsError: string })?.pathParamsError
              ),
              queryParamsError: JSON.stringify(
                (error as { queryParamsError: string })?.queryParamsError
              ),
              bodyError: JSON.stringify(
                (error as { bodyError: string })?.bodyError
              ),
              headerError: JSON.stringify(
                (error as { headerError: string })?.headerError
              ),
            },
          }
        : {}),
    },
    { status: 400 as const }
  );
};

export const toInternalServerError = () => {
  return TsRestResponse.fromJson(
    { message: ERROR_CODES.INTERNAL_ERROR },
    { status: 500 as const }
  );
};
