import { listAccounts } from '@demo-bank-app/banking';
import { getDependencies } from './dependencies';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { ServerInferRequest } from '@ts-rest/core';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';

export const listAccountsHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['listAccounts']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, logger } = await getDependencies();
  const { userId } = await extractAuthInfo(context.request);

  logger.info('Listing accounts', { userId });
  const accounts = await listAccounts({ userId }, { repository });
  return {
    status: 200 as const,
    body: {
      accounts: accounts.map(account => ({
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
      })),
    },
  };
};
