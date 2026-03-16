import { Money } from '../../domain/valueObjects/Money';
import { InvalidAccountError } from '../../domain/errors';
import { AccountNotFoundError, ForbiddenError } from '../errors';
import type { BankingRepository } from '../ports';
import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';
import { AccountResult } from '../dtos';
import { Account } from '../../domain/entities/Account';

export interface SetCreditLimitCommand {
  accountId: string;
  userId: string;
  creditLimitMinor: number;
}

export interface SetCreditLimitDependencies {
  repository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
}

const toAccountResult = (account: Account): AccountResult => {
  return {
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
  };
};

export async function setCreditLimit(
  command: SetCreditLimitCommand,
  dependencies: SetCreditLimitDependencies
): Promise<AccountResult> {
  const { repository, logger, metrics } = dependencies;
  const { accountId, userId, creditLimitMinor } = command;

  const timing = TimingUtils.startTiming(
    OPERATION_NAMES.BANKING.ACCOUNT_CREDIT_LIMIT_UPDATE
  );

  logger?.info('Credit limit update started', {
    accountId,
    userId,
    creditLimitMinor,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const account = await repository.getAccountById(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    if (!account.isOwnedBy(userId)) {
      throw new ForbiddenError('Access denied to account');
    }

    if (account.accountType !== 'CREDIT_LINE') {
      throw new InvalidAccountError(
        'accountType',
        'Credit limit updates are only supported for credit line accounts'
      );
    }

    const newLimit = new Money(creditLimitMinor);
    account.updateCreditLimit(newLimit);

    const updatedAccount = await repository.updateAccountBalance(account);

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_CREDIT_LIMIT_UPDATE,
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_CREDIT_LIMIT_UPDATE_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger?.info('Credit limit update completed', {
      accountId,
      userId,
      creditLimitMinor,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return toAccountResult(updatedAccount);
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Credit limit update failed', {
      accountId,
      userId,
      creditLimitMinor,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_CREDIT_LIMIT_UPDATE_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
