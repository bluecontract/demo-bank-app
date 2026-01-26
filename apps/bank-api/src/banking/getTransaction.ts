import {
  AccountNotFoundError,
  TransactionNotFoundError,
  getTransaction,
} from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { ERROR_CODES, problemResponse } from '../shared/errors';
import { getDependencies } from './dependencies';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';

export const getTransactionHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getTransaction']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const accountId = request.params?.accountId;
  const txnId = request.params?.txnId;

  try {
    logger.debug('Getting transaction', { userId, accountId, txnId });
    const transaction = await getTransaction(
      { userId, accountId, transactionId: txnId },
      { repository }
    );

    // Find the posting for the requested account
    const accountPosting = transaction.postings.find(
      p => p.accountId === accountId
    );
    if (!accountPosting) {
      return problemResponse({
        status: 404,
        message: 'Transaction not found for this account',
        code: ERROR_CODES.TRANSACTION_NOT_FOUND,
      });
    }

    return {
      status: 200 as const,
      body: {
        txnId: transaction.id,
        accountId: accountPosting.accountId,
        side: accountPosting.side,
        amountMinor: accountPosting.amount.toCents(),
        type: transaction.type,
        status: transaction.status,
        timestamp: transaction.createdAt.toISOString(),
        description: transaction.description,
        counterpartyAccountNumber: accountPosting.counterpartyAccountNumber,
      },
    };
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      return problemResponse({
        status: 404,
        message: err.message,
        code: ERROR_CODES.TRANSACTION_NOT_FOUND,
      });
    }
    if (err instanceof TransactionNotFoundError) {
      return problemResponse({
        status: 404,
        message: err.message,
        code: ERROR_CODES.TRANSACTION_NOT_FOUND,
      });
    }
    throw err;
  }
};
