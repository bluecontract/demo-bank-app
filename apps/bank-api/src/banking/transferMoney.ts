import {
  AccountNotFoundError,
  ForbiddenError,
  InsufficientFundsError,
  Money,
  transferMoney,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';

export const transferMoneyHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['transferMoney']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);

  const idempotencyKey = request.headers?.['idempotency-key'];
  if (!idempotencyKey) {
    return problemResponse({
      status: 400 as const,
      code: ERROR_CODES.MISSING_IDEMPOTENCY_KEY,
      message: 'Idempotency-Key header is required',
    });
  }
  try {
    logger.debug('Transferring money', { userId, ...request.body });
    const txnId = await transferMoney(
      {
        srcAccountId: request.body.sourceAccountId,
        dstAccountNumber: request.body.destinationAccountNumber,
        amountMinor: new Money(request.body.amountMinor),
        description: request.body.description ?? '',
        ctx: { userId, idempotencyKey },
      },
      { repository }
    );
    logger.debug('Money transferred', {
      userId,
      txnId,
      ...request.body,
    });
    return {
      status: 201 as const,
      body: {
        txnId,
      },
    };
  } catch (err) {
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
    if (err instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404 as const,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
        message: 'Account not found',
      });
    }
    throw err;
  }
};
