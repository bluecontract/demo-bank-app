import { createAccount } from '@demo-bank-app/banking';
import { getDependencies } from './dependencies';
import { bankApiContract } from '@demo-bank-app/shared-bank-api-contract';
import { ServerInferRequest } from '@ts-rest/core';
import {
  extractAuthInfo,
  MaybeAuthenticatedTsRestRequestContext,
} from '../auth/middleware';

export const createAccountHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['createAccount']
  >,
  context: {
    request: MaybeAuthenticatedTsRestRequestContext;
  }
) => {
  const { repository, accountNumberGenerator, logger } =
    await getDependencies();

  const { userId, isTest } = await extractAuthInfo(context.request);

  const { name } = request.body;

  logger.debug('Creating new account', { userId, name });
  const account = await createAccount(
    {
      ownerId: userId,
      name,
      isTest,
    },
    { repository, accountNumberGenerator }
  );
  logger.debug('Account created', {
    userId,
    accountId: account.id,
    name: account.name,
  });

  return {
    status: 201 as const,
    body: {
      accountId: account.id,
      accountNumber: account.accountNumber,
      name: account.name,
      currency: account.currency as 'USD',
      createdAt: account.createdAt.toISOString(),
      ledgerBalanceMinor: account.ledgerBalanceMinor.toCents(),
      availableBalanceMinor: account.availableBalanceMinor.toCents(),
      status: account.status,
    },
  };
};
