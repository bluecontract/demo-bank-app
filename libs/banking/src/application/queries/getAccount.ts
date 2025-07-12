import { Account } from '../../domain/entities/Account';
import { BankingRepository } from '../ports';
import { AccountNotFoundError } from '../errors';

export interface GetAccountQuery {
  userId: string;
  accountId: string;
}

export interface GetAccountDependencies {
  repository: BankingRepository;
}

export async function getAccount(
  query: GetAccountQuery,
  dependencies: GetAccountDependencies
): Promise<Account> {
  const { repository } = dependencies;

  const account = await repository.getAccountById(query.accountId);
  if (!account || !account.isOwnedBy(query.userId)) {
    throw new AccountNotFoundError(query.accountId);
  }

  return account;
}
