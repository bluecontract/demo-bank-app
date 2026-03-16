import {
  AccountNotFoundError,
  ForbiddenError,
  InvalidAccountError,
  OptimisticLockError,
  setCreditLimit,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import { ERROR_CODES, problemResponse } from '../shared/errors';

export const setCreditLimitHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['setCreditLimit']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const accountId = request.params?.accountId;

  try {
    logger.debug('Updating credit limit', {
      userId,
      accountId,
      creditLimitMinor: request.body.creditLimitMinor,
    });

    const account = await setCreditLimit(
      {
        accountId,
        userId,
        creditLimitMinor: request.body.creditLimitMinor,
      },
      { repository }
    );

    return {
      status: 200 as const,
      body: {
        accountId: account.id,
        accountNumber: account.accountNumber,
        name: account.name,
        currency: account.currency as 'USD',
        createdAt: account.createdAt.toISOString(),
        accountType: account.accountType,
        creditLimitMinor: account.creditLimitMinor?.toCents(),
        ledgerBalanceMinor: account.ledgerBalanceMinor.toCents(),
        availableBalanceMinor: account.availableBalanceMinor.toCents(),
        status: account.status,
      },
    };
  } catch (error: unknown) {
    if (error instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404 as const,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: 'Account not found',
      });
    }

    if (error instanceof ForbiddenError) {
      return problemResponse({
        status: 403 as const,
        code: ERROR_CODES.FORBIDDEN,
        message: 'Forbidden access',
      });
    }

    if (error instanceof InvalidAccountError) {
      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: error.message,
      });
    }

    if (error instanceof OptimisticLockError) {
      return problemResponse({
        status: 409 as const,
        code: ERROR_CODES.ACCOUNT_CONFLICT,
        message: 'Account was updated concurrently. Please retry.',
      });
    }

    throw error;
  }
};
