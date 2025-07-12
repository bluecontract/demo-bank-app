import { BankingRepository } from '../ports';
import { AccountResult } from '../dtos';

export interface ListAccountsQuery {
  userId: string;
}

export interface ListAccountsDependencies {
  repository: BankingRepository;
}

export async function listAccounts(
  query: ListAccountsQuery,
  dependencies: ListAccountsDependencies
): Promise<AccountResult[]> {
  const { repository } = dependencies;

  const accounts = await repository.getAccountsByUserId(query.userId);

  return accounts.map(account => ({
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
  }));
}
