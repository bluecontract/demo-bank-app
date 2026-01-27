import { AccountNotFoundError, getAccount } from '@demo-bank-app/banking';
import { ServerInferRequest } from '@ts-rest/core';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { getDependencies } from './dependencies';
import { ERROR_CODES } from '../shared/errors';

export const getAccountHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['getAccount']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);
  const accountId = request.params?.accountId;

  try {
    logger.debug('Getting account', { userId, accountId });
    const account = await getAccount({ userId, accountId }, { repository });
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
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      return {
        status: 404 as const,
        body: {
          error: ERROR_CODES.ACCOUNT_NOT_FOUND,
          message: 'Account not found',
        },
      };
    }
    throw err;
  }
};
