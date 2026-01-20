import { randomUUID } from 'crypto';
import { hashIdempotencyKey } from '../../domain/idempotency';
import { Money } from '../../domain/valueObjects/Money';
import { Posting } from '../../domain/valueObjects/Posting';
import { Transaction } from '../../domain/entities/Transaction';
import type { Hold } from '../../domain/entities/Hold';
import {
  AccountNotFoundError,
  ForbiddenError,
  HoldNotFoundError,
  HoldNotPendingError,
  HoldCounterpartyMismatchError,
  HoldCounterpartyRequiredError,
} from '../errors';
import type { BankingRepository } from '../ports';
import type {
  HoldRepository,
  CaptureHoldRequest,
  CaptureHoldResult,
} from '../HoldRepository';
import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';

export interface CaptureHoldCommand {
  holdId: Hold['holdId'];
  userId: string;
  idempotencyKey: string;
  counterpartyAccountNumber?: string;
  payNoteDocumentId?: string;
}

export interface CaptureHoldDependencies {
  holdRepository: HoldRepository;
  bankingRepository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
  clock?: () => Date;
  transactionIdGenerator?: () => string;
}

export async function captureHold(
  cmd: CaptureHoldCommand,
  deps: CaptureHoldDependencies
): Promise<Hold> {
  const {
    holdRepository,
    bankingRepository,
    logger,
    metrics,
    clock = () => new Date(),
    transactionIdGenerator = randomUUID,
  } = deps;

  const timing = TimingUtils.startTiming(
    OPERATION_NAMES.BANKING?.CAPTURE_HOLD ?? 'CaptureHold'
  );

  logger?.info('Capture hold started', {
    holdId: cmd.holdId,
    userId: cmd.userId,
    idempotencyKey: cmd.idempotencyKey,
    counterpartyAccountNumber: cmd.counterpartyAccountNumber,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const existingHold = await holdRepository.getHold(cmd.holdId);
    if (!existingHold) {
      throw new HoldNotFoundError(cmd.holdId);
    }

    if (
      existingHold.counterpartyAccountNumber &&
      cmd.counterpartyAccountNumber &&
      existingHold.counterpartyAccountNumber !== cmd.counterpartyAccountNumber
    ) {
      throw new HoldCounterpartyMismatchError(
        existingHold.holdId,
        existingHold.counterpartyAccountNumber,
        cmd.counterpartyAccountNumber
      );
    }

    if (existingHold.status === 'CAPTURED') {
      const completedTiming = TimingUtils.endTiming(timing);

      metrics?.addMetric(
        METRIC_NAMES.BANKING?.CAPTURE_HOLD_SUCCESS ?? 'CaptureHoldSuccess',
        METRIC_UNITS.COUNT,
        1
      );
      metrics?.addMetric(
        METRIC_NAMES.BANKING?.CAPTURE_HOLD_DURATION ?? 'CaptureHoldDuration',
        METRIC_UNITS.MILLISECONDS,
        completedTiming.duration ?? 0
      );

      logger?.info('Capture hold completed (idempotent)', {
        holdId: existingHold.holdId,
        userId: cmd.userId,
        idempotencyKey: cmd.idempotencyKey,
        transactionId: existingHold.relatedTransactionId,
        counterpartyAccountNumber:
          existingHold.counterpartyAccountNumber ??
          cmd.counterpartyAccountNumber,
        created: false,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return existingHold;
    }

    if (existingHold.status !== 'PENDING') {
      throw new HoldNotPendingError(cmd.holdId, existingHold.status);
    }

    const resolvedCounterparty =
      existingHold.counterpartyAccountNumber ?? cmd.counterpartyAccountNumber;
    if (!resolvedCounterparty) {
      throw new HoldCounterpartyRequiredError(existingHold.holdId);
    }

    const payerAccountId = await bankingRepository.getAccountIdByNumber(
      existingHold.payerAccountNumber
    );
    if (!payerAccountId) {
      throw new AccountNotFoundError(existingHold.payerAccountNumber);
    }

    const [payerAccount, counterpartyAccountId] = await Promise.all([
      bankingRepository.getAccountById(payerAccountId),
      bankingRepository.getAccountIdByNumber(resolvedCounterparty),
    ]);

    if (!payerAccount) {
      throw new AccountNotFoundError(payerAccountId);
    }

    if (!payerAccount.isOwnedBy(cmd.userId)) {
      throw new ForbiddenError('Access denied to payer account');
    }

    if (!counterpartyAccountId) {
      throw new AccountNotFoundError(resolvedCounterparty);
    }

    const counterpartyAccount = await bankingRepository.getAccountById(
      counterpartyAccountId
    );
    if (!counterpartyAccount) {
      throw new AccountNotFoundError(counterpartyAccountId);
    }

    payerAccount.ensureActive();
    counterpartyAccount.ensureActive();

    const amount = new Money(existingHold.amountMinor);

    const debitPosting = new Posting({
      accountId: payerAccount.id,
      amount,
      side: 'DEBIT',
      accountNumber: payerAccount.accountNumber,
      counterpartyAccountNumber: counterpartyAccount.accountNumber,
    });

    const creditPosting = new Posting({
      accountId: counterpartyAccount.id,
      amount,
      side: 'CREDIT',
      accountNumber: counterpartyAccount.accountNumber,
      counterpartyAccountNumber: payerAccount.accountNumber,
    });

    const capturedAt = clock();
    const capturedAtIso = capturedAt.toISOString();

    const transactionId = transactionIdGenerator();
    const transaction = Transaction.createWithId(
      [debitPosting, creditPosting],
      {
        idempotencyKey: cmd.idempotencyKey,
        description:
          existingHold.description ??
          `Captured hold ${existingHold.holdId} to ${resolvedCounterparty}`,
        createdAt: capturedAt,
        originHoldId: existingHold.holdId,
        payNoteDocumentId:
          cmd.payNoteDocumentId ?? existingHold.payNoteDocumentId,
      },
      transactionId
    );
    const idempotencyKeyHash = hashIdempotencyKey(cmd.idempotencyKey);

    const updatedHold: Hold = {
      ...existingHold,
      status: 'CAPTURED',
      counterpartyAccountNumber: resolvedCounterparty,
      relatedTransactionId: transaction.id,
    };

    const captureRequest: CaptureHoldRequest = {
      payerAccountId: payerAccount.id,
      payerAccountBalanceVersion: payerAccount.balanceVersion,
      counterpartyAccountId: counterpartyAccount.id,
      counterpartyAccountBalanceVersion: counterpartyAccount.balanceVersion,
      hold: updatedHold,
      holdEvent: {
        at: capturedAtIso,
        type: 'CAPTURED',
        transactionId: transaction.id,
        counterpartyAccountNumber: resolvedCounterparty,
        payNoteDocumentId: cmd.payNoteDocumentId,
      },
      transaction,
      idempotencyKey: cmd.idempotencyKey,
      idempotencyKeyHash,
      userId: cmd.userId,
    };

    const result: CaptureHoldResult = await holdRepository.captureHold(
      captureRequest
    );

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING?.CAPTURE_HOLD_SUCCESS ?? 'CaptureHoldSuccess',
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING?.CAPTURE_HOLD_DURATION ?? 'CaptureHoldDuration',
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration ?? 0
    );

    logger?.info('Capture hold completed', {
      holdId: result.hold.holdId,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      transactionId: result.transactionId,
      counterpartyAccountNumber: resolvedCounterparty,
      created: result.created,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return result.hold;
  } catch (error) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Capture hold failed', {
      holdId: cmd.holdId,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      counterpartyAccountNumber: cmd.counterpartyAccountNumber,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING?.CAPTURE_HOLD_ERROR ?? 'CaptureHoldError',
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
