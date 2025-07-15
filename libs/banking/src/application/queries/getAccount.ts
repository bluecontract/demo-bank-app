import { AccountNotFoundError } from '../errors';
import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-blue/shared-observability';
import type { BankingRepository } from '../ports';
import { AccountResult } from '../dtos';

export interface GetAccountQuery {
  userId: string;
  accountId: string;
}

export interface GetAccountDependencies {
  repository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
}

export async function getAccount(
  query: GetAccountQuery,
  dependencies: GetAccountDependencies
): Promise<AccountResult> {
  const { repository, logger, metrics } = dependencies;
  const { userId, accountId } = query;

  const timing = TimingUtils.startTiming(OPERATION_NAMES.BANKING.ACCOUNT_GET);

  logger?.debug('Account retrieval started', {
    userId,
    accountId,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const account = await repository.getAccountById(accountId);

    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    if (!account.isOwnedBy(userId)) {
      throw new AccountNotFoundError(accountId);
    }

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(METRIC_NAMES.BANKING.ACCOUNT_GET, METRIC_UNITS.COUNT, 1);
    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_GET_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger?.debug('Account retrieval completed successfully', {
      userId,
      accountId,
      accountNumber: account.accountNumber,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

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
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Account retrieval failed', {
      userId,
      accountId,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_GET_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
