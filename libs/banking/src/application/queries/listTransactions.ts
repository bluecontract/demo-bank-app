import { AccountNotFoundError } from '../errors';
import { PaginationOptions, PaginatedResult } from '../../domain/types';
import { TransactionSummary } from '../ports';
import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';
import type { BankingRepository } from '../ports';

export interface ListTransactionsQuery {
  userId: string;
  accountId: string;
  pagination?: PaginationOptions;
}

export interface ListTransactionsDependencies {
  repository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
}

export async function listTransactions(
  query: ListTransactionsQuery,
  dependencies: ListTransactionsDependencies
): Promise<PaginatedResult<TransactionSummary>> {
  const { repository, logger, metrics } = dependencies;
  const { userId, accountId, pagination } = query;

  const timing = TimingUtils.startTiming(
    OPERATION_NAMES.BANKING.TRANSACTION_LIST
  );

  logger?.debug('Transaction listing started', {
    userId,
    accountId,
    pagination,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const account = await repository.getAccountById(accountId);

    if (!account || !account.isOwnedBy(userId)) {
      throw new AccountNotFoundError(accountId);
    }

    const transactions = await repository.getTransactionsByAccount(
      accountId,
      pagination
    );

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING.TRANSACTION_LIST,
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING.TRANSACTION_LIST_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger?.debug('Transaction listing completed successfully', {
      userId,
      accountId,
      transactionCount: transactions.items.length,
      hasMore: transactions.hasMore,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return transactions;
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Transaction listing failed', {
      userId,
      accountId,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING.TRANSACTION_LIST_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
