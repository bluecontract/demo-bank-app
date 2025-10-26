import { FUNDING_SOURCE } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { transferMoney } from './transferMoney';
import type { Logger, Metrics } from '../../domain/types';
import { AccountNotFoundError } from '../errors';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';
import type { BankingRepository, TransactionContext } from '../ports';

export interface FundAccountCommand {
  accountId: string;
  amountMinor: Money;
  ctx: TransactionContext;
}

export interface FundAccountDependencies {
  repository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
}

export async function fundAccount(
  command: FundAccountCommand,
  dependencies: FundAccountDependencies
): Promise<string> {
  const { repository, logger, metrics } = dependencies;
  const { accountId, amountMinor, ctx } = command;

  const timing = TimingUtils.startTiming(OPERATION_NAMES.BANKING.ACCOUNT_FUND);

  logger?.info('Account funding started', {
    accountId,
    amountMinor: amountMinor.toCents(),
    userId: ctx.userId,
    idempotencyKey: ctx.idempotencyKey,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const account = await repository.getAccountById(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    const txnId = await transferMoney(
      {
        srcAccountId: FUNDING_SOURCE.ACCOUNT_ID,
        dstAccountNumber: account.accountNumber,
        amountMinor,
        description: `Funding for account ${account.accountNumber}`,
        ctx,
      },
      { repository, logger, metrics }
    );

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_FUND,
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_FUND_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger?.info('Account funding completed successfully', {
      accountId,
      amountMinor: amountMinor.toCents(),
      txnId,
      userId: ctx.userId,
      idempotencyKey: ctx.idempotencyKey,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return txnId;
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Account funding failed', {
      accountId,
      amountMinor: amountMinor.toCents(),
      userId: ctx.userId,
      idempotencyKey: ctx.idempotencyKey,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_FUND_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
