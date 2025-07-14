import { AccountNotFoundError, listTransactions } from '@demo-blue/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-blue/shared-bank-api-contract';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';

export const listTransactionsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listTransactions']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const accountId = request.params?.accountId;

  try {
    logger.info('Listing transactions', { userId, accountId });
    const result = await listTransactions(
      {
        userId,
        accountId,
        pagination: {
          limit: request.query?.limit,
          nextToken: request.query?.cursor,
        },
      },
      { repository }
    );

    return {
      status: 200 as const,
      body: {
        items: result.items.map(item => ({
          txnId: item.transactionId,
          accountId: accountId,
          side: item.side,
          amountMinor: item.amount.toCents(),
          type: item.type,
          status: item.status,
          timestamp: item.createdAt.toISOString(),
          description: item.description,
          counterpartyAccountNumber: item.counterpartyAccountNumber || '',
        })),
        next: result.nextToken,
      },
    };
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404,
        message: err.message,
        code: ERROR_CODES.ACCOUNT_NOT_FOUND,
      });
    }
    throw err;
  }
};
