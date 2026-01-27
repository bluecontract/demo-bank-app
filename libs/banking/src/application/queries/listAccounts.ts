import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';
import type { BankingRepository } from '../ports';
import { AccountResult } from '../dtos';

export interface ListAccountsQuery {
  userId: string;
}

export interface ListAccountsDependencies {
  repository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
}

export async function listAccounts(
  query: ListAccountsQuery,
  dependencies: ListAccountsDependencies
): Promise<AccountResult[]> {
  const { repository, logger, metrics } = dependencies;
  const { userId } = query;

  const timing = TimingUtils.startTiming(OPERATION_NAMES.BANKING.ACCOUNT_LIST);

  logger?.debug('Account listing started', {
    userId,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const accounts = await repository.getAccountsByUserId(userId);

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_LIST,
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_LIST_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger?.debug('Account listing completed successfully', {
      userId,
      accountCount: accounts.length,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return accounts.map(account => ({
      id: account.id,
      accountNumber: account.accountNumber,
      name: account.name,
      ownerUserId: account.ownerUserId,
      status: account.status,
      currency: account.currency,
      createdAt: account.createdAt,
      accountType: account.accountType,
      creditLimitMinor: account.creditLimitMinor,
      ledgerBalanceMinor: account.ledgerBalanceMinor,
      availableBalanceMinor: account.availableBalanceMinor,
      balanceVersion: account.balanceVersion,
    }));
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Account listing failed', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_LIST_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
