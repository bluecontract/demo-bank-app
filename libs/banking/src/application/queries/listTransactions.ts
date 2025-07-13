import { BankingRepository, TransactionSummary } from '../ports';
import { PaginationOptions, PaginatedResult } from '../../domain/types';
import { AccountNotFoundError } from '../errors';

export interface ListTransactionsQuery {
  userId: string;
  accountId: string;
  pagination?: PaginationOptions;
}

export interface ListTransactionsDependencies {
  repository: BankingRepository;
}

export async function listTransactions(
  query: ListTransactionsQuery,
  dependencies: ListTransactionsDependencies
): Promise<PaginatedResult<TransactionSummary>> {
  const { repository } = dependencies;

  const account = await repository.getAccountById(query.accountId);
  if (!account || !account.isOwnedBy(query.userId)) {
    throw new AccountNotFoundError(query.accountId);
  }

  return await repository.getTransactionsByAccount(
    query.accountId,
    query.pagination
  );
}
