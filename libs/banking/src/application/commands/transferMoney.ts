import { Transaction } from '../../domain/entities/Transaction';
import { Posting, Side } from '../../domain/valueObjects/Posting';
import { Money } from '../../domain/valueObjects/Money';
import { BankingRepository, TransactionContext } from '../ports';
import { ForbiddenError, AccountNotFoundError } from '../errors';
import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';

export interface TransferMoneyCommand {
  srcAccountId: string;
  dstAccountNumber: string;
  amountMinor: Money;
  description: string;
  ctx: TransactionContext;
  payNoteDocumentId?: string;
}

export interface TransferMoneyDependencies {
  repository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
}

export async function transferMoney(
  cmd: TransferMoneyCommand,
  deps: TransferMoneyDependencies
): Promise<string> {
  const { repository, logger, metrics } = deps;
  const {
    srcAccountId,
    dstAccountNumber,
    amountMinor,
    description,
    ctx,
    payNoteDocumentId,
  } = cmd;

  const timing = TimingUtils.startTiming(
    OPERATION_NAMES.BANKING.MONEY_TRANSFER
  );

  logger?.info('Money transfer started', {
    srcAccountId,
    dstAccountNumber,
    amountMinor: amountMinor.toCents(),
    description,
    userId: ctx.userId,
    idempotencyKey: ctx.idempotencyKey,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const dstAccountId = await repository.getAccountIdByNumber(
      dstAccountNumber
    );
    if (!dstAccountId) {
      throw new AccountNotFoundError(
        dstAccountNumber,
        new Error(`Destination account ${dstAccountNumber} not found by number`)
      );
    }

    const [src, dst] = await Promise.all([
      repository.getAccountById(srcAccountId),
      repository.getAccountById(dstAccountId),
    ]);

    if (!src) {
      throw new AccountNotFoundError(srcAccountId);
    }

    if (!dst) {
      throw new AccountNotFoundError(dstAccountId);
    }

    if (!src.isOwnedBy(ctx.userId)) {
      throw new ForbiddenError('Access denied to source account');
    }

    src.ensureSufficientFunds(amountMinor);
    dst.ensureActive();

    const debit = new Posting({
      accountId: src.id,
      amount: amountMinor,
      side: 'DEBIT' as Side,
      accountNumber: src.accountNumber,
      counterpartyAccountNumber: dst.accountNumber,
    });

    const credit = new Posting({
      accountId: dst.id,
      amount: amountMinor,
      side: 'CREDIT' as Side,
      accountNumber: dst.accountNumber,
      counterpartyAccountNumber: src.accountNumber,
    });

    src.applyPosting(debit);
    dst.applyPosting(credit);

    const txn = Transaction.create([debit, credit], {
      idempotencyKey: ctx.idempotencyKey,
      description,
      payNoteDocumentId,
    });

    const txnId = await repository.saveTransactionWithAccounts(
      txn,
      [src, dst],
      ctx
    );

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING.MONEY_TRANSFER,
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING.MONEY_TRANSFER_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger?.info('Money transfer completed successfully', {
      srcAccountId,
      dstAccountNumber,
      amountMinor: amountMinor.toCents(),
      description,
      txnId,
      userId: ctx.userId,
      idempotencyKey: ctx.idempotencyKey,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return txnId;
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Money transfer failed', {
      srcAccountId,
      dstAccountNumber,
      amountMinor: amountMinor.toCents(),
      description,
      userId: ctx.userId,
      idempotencyKey: ctx.idempotencyKey,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING.MONEY_TRANSFER_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
