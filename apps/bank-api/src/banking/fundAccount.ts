import { InsufficientFundsError } from '@demo-blue/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-blue/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { Money } from '@demo-blue/banking';
import { fundAccount } from '@demo-blue/banking';
import { AccountNotFoundError, ForbiddenError } from '@demo-blue/banking';
import { ERROR_CODES, problemResponse } from '../shared/errors';

export const fundAccountHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['fundAccount']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const accountId = request.params?.accountId;

  const idempotencyKey = request.headers?.['idempotency-key'];
  if (!idempotencyKey) {
    return problemResponse({
      status: 400 as const,
      code: ERROR_CODES.MISSING_IDEMPOTENCY_KEY,
      message: 'Idempotency-Key header is required',
    });
  }
  try {
    logger.info('Funding account', { userId, accountId, ...request.body });
    const txnId = await fundAccount(
      {
        accountId,
        amountMinor: new Money(request.body.amountMinor),
        ctx: { userId, idempotencyKey },
      },
      { repository }
    );
    logger.info('Account funded', {
      userId,
      accountId,
      txnId,
      amountMinor: request.body.amountMinor,
    });
    return {
      status: 201 as const,
      body: { txnId },
    };
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404 as const,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: 'Account not found',
      });
    }
    if (err instanceof ForbiddenError) {
      return problemResponse({
        status: 403 as const,
        code: ERROR_CODES.FORBIDDEN,
        message: 'Forbidden access',
      });
    }
    if (err instanceof InsufficientFundsError) {
      return problemResponse({
        status: 400 as const,
        code: ERROR_CODES.INSUFFICIENT_FUNDS,
        message: 'Insufficient funds',
      });
    }
    throw err;
  }
};
