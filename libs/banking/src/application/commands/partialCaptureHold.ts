import { randomUUID } from 'crypto';
import { hashIdempotencyKey } from '../../domain/idempotency';
import { Money } from '../../domain/valueObjects/Money';
import { Posting } from '../../domain/valueObjects/Posting';
import { Transaction } from '../../domain/entities/Transaction';
import type { Hold } from '../../domain/entities/Hold';
import {
  AccountNotFoundError,
  ForbiddenError,
  HoldCaptureDisabledError,
  HoldCounterpartyMismatchError,
  HoldCounterpartyRequiredError,
  HoldNotFoundError,
  HoldNotPendingError,
  IdempotencyConflictError,
} from '../errors';
import type { BankingRepository } from '../ports';
import type {
  HoldRepository,
  PartialCaptureHoldRequest,
  PartialCaptureHoldResult,
} from '../HoldRepository';
import type { Logger, Metrics } from '../../domain/types';
import { InvalidMoneyAmountError } from '../../domain/errors';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';

export interface PartialCaptureHoldCommand {
  holdId: Hold['holdId'];
  userId: string;
  idempotencyKey: string;
  amountMinor: number;
  counterpartyAccountNumber?: string;
  payNoteDocumentId?: string;
}

export interface PartialCaptureHoldDependencies {
  holdRepository: HoldRepository;
  bankingRepository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
  clock?: () => Date;
  transactionIdGenerator?: () => string;
}

const MAX_OPTIMISTIC_LOCK_ATTEMPTS = 3;
const OPTIMISTIC_LOCK_ERROR_CODE = 'OPTIMISTIC_LOCK_ERROR';

const isOptimisticLockError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (code === OPTIMISTIC_LOCK_ERROR_CODE) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('Optimistic lock failed');
};

export async function partialCaptureHold(
  cmd: PartialCaptureHoldCommand,
  deps: PartialCaptureHoldDependencies
): Promise<PartialCaptureHoldResult> {
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

  logger?.info('Partial capture hold started', {
    holdId: cmd.holdId,
    userId: cmd.userId,
    idempotencyKey: cmd.idempotencyKey,
    amountMinor: cmd.amountMinor,
    counterpartyAccountNumber: cmd.counterpartyAccountNumber,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    let attempt = 0;
    while (true) {
      attempt += 1;

      try {
        const captureAmount = new Money(cmd.amountMinor);
        if (!captureAmount.isPositive()) {
          throw new InvalidMoneyAmountError(cmd.amountMinor);
        }

        const existingHold = await holdRepository.getHold(cmd.holdId);
        if (!existingHold) {
          throw new HoldNotFoundError(cmd.holdId);
        }

        if (existingHold.status === 'CAPTURED') {
          throw new HoldNotPendingError(cmd.holdId, existingHold.status);
        }

        if (
          existingHold.status !== 'PENDING' &&
          existingHold.status !== 'PARTIALLY_CAPTURED'
        ) {
          throw new HoldNotPendingError(cmd.holdId, existingHold.status);
        }

        if (
          existingHold.captureDisabled &&
          (existingHold.status === 'PENDING' ||
            existingHold.status === 'PARTIALLY_CAPTURED')
        ) {
          throw new HoldCaptureDisabledError(cmd.holdId);
        }

        const existingCapturedAmount = existingHold.capturedAmountMinor ?? 0;
        const remainingAmount = Math.max(
          existingHold.amountMinor - existingCapturedAmount,
          0
        );

        if (captureAmount.toCents() > remainingAmount) {
          throw new IdempotencyConflictError(
            'Capture amount exceeds remaining authorized amount'
          );
        }

        if (
          existingHold.counterpartyAccountNumber &&
          cmd.counterpartyAccountNumber &&
          existingHold.counterpartyAccountNumber !==
            cmd.counterpartyAccountNumber
        ) {
          throw new HoldCounterpartyMismatchError(
            existingHold.holdId,
            existingHold.counterpartyAccountNumber,
            cmd.counterpartyAccountNumber
          );
        }

        const resolvedCounterparty =
          existingHold.counterpartyAccountNumber ??
          cmd.counterpartyAccountNumber;
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

        const debitPosting = new Posting({
          accountId: payerAccount.id,
          amount: captureAmount,
          side: 'DEBIT',
          accountNumber: payerAccount.accountNumber,
          counterpartyAccountNumber: counterpartyAccount.accountNumber,
        });

        const creditPosting = new Posting({
          accountId: counterpartyAccount.id,
          amount: captureAmount,
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
              `Partially captured hold ${existingHold.holdId}`,
            createdAt: capturedAt,
            originHoldId: existingHold.holdId,
            payNoteDocumentId:
              cmd.payNoteDocumentId ?? existingHold.payNoteDocumentId,
          },
          transactionId
        );

        const updatedCapturedAmount =
          existingCapturedAmount + captureAmount.toCents();
        const remainingAfterCapture = Math.max(
          existingHold.amountMinor - updatedCapturedAmount,
          0
        );
        const isFullyCaptured =
          updatedCapturedAmount >= existingHold.amountMinor;

        const updatedHold: Hold = {
          ...existingHold,
          status: isFullyCaptured ? 'CAPTURED' : 'PARTIALLY_CAPTURED',
          capturedAmountMinor: updatedCapturedAmount,
          counterpartyAccountNumber: resolvedCounterparty,
          relatedTransactionId: transaction.id,
        };

        const idempotencyKeyHash = hashIdempotencyKey(cmd.idempotencyKey);

        const holdEvent = isFullyCaptured
          ? {
              at: capturedAtIso,
              type: 'CAPTURED' as const,
              transactionId: transaction.id,
              counterpartyAccountNumber: resolvedCounterparty,
              amountMinor: captureAmount.toCents(),
              remainingAmountMinor: remainingAfterCapture,
              payNoteDocumentId: cmd.payNoteDocumentId,
            }
          : {
              at: capturedAtIso,
              type: 'CAPTURED_PARTIAL' as const,
              transactionId: transaction.id,
              counterpartyAccountNumber: resolvedCounterparty,
              amountMinor: captureAmount.toCents(),
              remainingAmountMinor: remainingAfterCapture,
              payNoteDocumentId: cmd.payNoteDocumentId,
            };

        const captureRequest: PartialCaptureHoldRequest = {
          payerAccountId: payerAccount.id,
          payerAccountBalanceVersion: payerAccount.balanceVersion,
          counterpartyAccountId: counterpartyAccount.id,
          counterpartyAccountBalanceVersion: counterpartyAccount.balanceVersion,
          hold: updatedHold,
          holdEvent,
          transaction,
          captureAmountMinor: captureAmount.toCents(),
          idempotencyKey: cmd.idempotencyKey,
          idempotencyKeyHash,
          userId: cmd.userId,
        };

        const result = await holdRepository.partialCaptureHold(captureRequest);

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

        logger?.info('Partial capture hold completed', {
          holdId: result.hold.holdId,
          userId: cmd.userId,
          idempotencyKey: cmd.idempotencyKey,
          transactionId: result.transactionId,
          counterpartyAccountNumber: resolvedCounterparty,
          capturedAmountMinor: captureAmount.toCents(),
          created: result.created,
          attemptNumber: attempt,
          ...TimingUtils.createTimingMetadata(completedTiming),
        });

        return result;
      } catch (error) {
        const shouldRetry =
          isOptimisticLockError(error) &&
          attempt < MAX_OPTIMISTIC_LOCK_ATTEMPTS;
        if (!shouldRetry) {
          throw error;
        }

        logger?.warn('Partial capture optimistic lock conflict, retrying', {
          holdId: cmd.holdId,
          userId: cmd.userId,
          idempotencyKey: cmd.idempotencyKey,
          attemptNumber: attempt,
          maxAttemptCount: MAX_OPTIMISTIC_LOCK_ATTEMPTS,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Partial capture hold failed', {
      holdId: cmd.holdId,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      counterpartyAccountNumber: cmd.counterpartyAccountNumber,
      amountMinor: cmd.amountMinor,
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
