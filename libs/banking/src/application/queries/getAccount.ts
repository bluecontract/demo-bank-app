import { BankingRepository } from '../ports';
import { AccountNotFoundError } from '../errors';
import { AccountResult } from '../dtos';

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
): Promise<AccountResult> {
  const { repository } = dependencies;

  const account = await repository.getAccountById(query.accountId);
  if (!account || !account.isOwnedBy(query.userId)) {
    throw new AccountNotFoundError(query.accountId);
  }

  return {
    id: account.id,
    accountNumber: account.accountNumber,
    name: account.name,
    ownerUserId: account.ownerUserId,
    status: account.status,
    currency: account.currency,
    createdAt: account.createdAt,
    ledgerBalanceMinor: account.ledgerBalanceMinor,
    availableBalanceMinor: account.availableBalanceMinor,
    balanceVersion: account.balanceVersion,
  };
}
