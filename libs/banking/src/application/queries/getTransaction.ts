import { TransactionNotFoundError, AccountNotFoundError } from '../errors';
import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';
import type { BankingRepository } from '../ports';
import { TransactionResult } from '../dtos';

export interface GetTransactionQuery {
  userId: string;
  accountId: string;
  transactionId: string;
}

export interface GetTransactionDependencies {
  repository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
}

export async function getTransaction(
  query: GetTransactionQuery,
  dependencies: GetTransactionDependencies
): Promise<TransactionResult> {
  const { repository, logger, metrics } = dependencies;
  const { userId, accountId, transactionId } = query;

  const timing = TimingUtils.startTiming(
    OPERATION_NAMES.BANKING.TRANSACTION_GET
  );

  logger?.debug('Transaction retrieval started', {
    userId,
    transactionId,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const account = await repository.getAccountById(accountId);
    if (!account || !account.isOwnedBy(userId)) {
      throw new AccountNotFoundError(accountId);
    }

    const transaction = await repository.getTransactionById(transactionId);
    if (!transaction) {
      throw new TransactionNotFoundError(transactionId);
    }

    const transactionInvolvesAccount = transaction.postings.some(posting => {
      return posting.accountId === accountId;
    });

    if (!transactionInvolvesAccount) {
      throw new TransactionNotFoundError(transactionId);
    }

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING.TRANSACTION_GET,
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING.TRANSACTION_GET_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger?.debug('Transaction retrieval completed successfully', {
      userId,
      transactionId,
      type: transaction.type,
      status: transaction.status,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return {
      id: transaction.id,
      type: transaction.type,
      status: transaction.status,
      postings: transaction.postings.map(posting => ({
        accountId: posting.accountId,
        amount: posting.amount,
        side: posting.side,
        accountNumber: posting.accountNumber,
        counterpartyAccountNumber: posting.counterpartyAccountNumber,
      })),
      description: transaction.description,
      transactionIdempotencyKey: transaction.transactionIdempotencyKey,
      createdAt: transaction.createdAt,
      cardId: transaction.cardId,
      cardLast4: transaction.cardLast4,
      merchantName: transaction.merchantName,
      merchantId: transaction.merchantId,
      merchantStatementDescriptor: transaction.merchantStatementDescriptor,
      processorChargeId: transaction.processorChargeId,
    };
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Transaction retrieval failed', {
      userId,
      transactionId,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING.TRANSACTION_GET_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
