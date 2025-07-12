import { BankingRepository } from '../ports';
import { AccountNotFoundError, TransactionNotFoundError } from '../errors';
import { TransactionResult } from '../dtos';
import { Transaction } from '../../domain/entities/Transaction';
import { Posting } from '../../domain/valueObjects/Posting';

export interface GetTransactionQuery {
  userId: string;
  accountId: string;
  transactionId: string;
}

export interface GetTransactionDependencies {
  repository: BankingRepository;
}

function toTransactionResult(transaction: Transaction): TransactionResult {
  return {
    id: transaction.id,
    type: transaction.type,
    status: transaction.status,
    postings: transaction.postings.map((posting: Posting) => ({
      accountId: posting.accountId,
      amount: posting.amount,
      side: posting.side,
      accountNumber: posting.accountNumber,
      counterpartyAccountNumber: posting.counterpartyAccountNumber,
    })),
    description: transaction.description,
    transactionIdempotencyKey: transaction.transactionIdempotencyKey,
    createdAt: transaction.createdAt,
  };
}

export async function getTransaction(
  query: GetTransactionQuery,
  dependencies: GetTransactionDependencies
): Promise<TransactionResult> {
  const { repository } = dependencies;

  const account = await repository.getAccountById(query.accountId);
  if (!account || !account.isOwnedBy(query.userId)) {
    throw new AccountNotFoundError(query.accountId);
  }

  const transaction = await repository.getTransactionById(query.transactionId);
  if (!transaction) {
    throw new TransactionNotFoundError(query.transactionId);
  }

  const transactionInvolvesAccount = transaction.postings.some(
    posting => posting.accountId === query.accountId
  );

  if (!transactionInvolvesAccount) {
    throw new TransactionNotFoundError(query.transactionId);
  }

  return toTransactionResult(transaction);
}
