import { hashIdempotencyKey } from '../../domain/idempotency';
import type { Hold } from '../../domain/entities/Hold';
import {
  AccountNotFoundError,
  ForbiddenError,
  HoldNotFoundError,
  HoldNotPendingError,
  IdempotencyConflictError,
} from '../errors';
import type { BankingRepository } from '../ports';
import type {
  HoldRepository,
  PartialReleaseHoldRequest,
  PartialReleaseHoldResult,
} from '../HoldRepository';
import type { Logger, Metrics } from '../../domain/types';
import { InvalidMoneyAmountError } from '../../domain/errors';
import { Money } from '../../domain/valueObjects/Money';
import {
  METRIC_NAMES,
  METRIC_UNITS,
  OPERATION_NAMES,
  TimingUtils,
} from '@demo-bank-app/shared-observability';

export interface PartialReleaseHoldCommand {
  holdId: Hold['holdId'];
  userId: string;
  idempotencyKey: string;
  amountMinor: number;
  reason?: string;
  payNoteDocumentId?: string;
}

export interface PartialReleaseHoldDependencies {
  holdRepository: HoldRepository;
  bankingRepository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
  clock?: () => Date;
}

export async function partialReleaseHold(
  cmd: PartialReleaseHoldCommand,
  deps: PartialReleaseHoldDependencies
): Promise<Hold> {
  const {
    holdRepository,
    bankingRepository,
    logger,
    metrics,
    clock = () => new Date(),
  } = deps;

  const timing = TimingUtils.startTiming(
    OPERATION_NAMES.BANKING?.RELEASE_HOLD ?? 'ReleaseHold'
  );

  logger?.info('Partial release hold started', {
    holdId: cmd.holdId,
    userId: cmd.userId,
    idempotencyKey: cmd.idempotencyKey,
    amountMinor: cmd.amountMinor,
    reason: cmd.reason,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const releaseAmount = new Money(cmd.amountMinor);
    if (!releaseAmount.isPositive()) {
      throw new InvalidMoneyAmountError(cmd.amountMinor);
    }

    const existingHold = await holdRepository.getHold(cmd.holdId);
    if (!existingHold) {
      throw new HoldNotFoundError(cmd.holdId);
    }

    if (
      existingHold.status !== 'PENDING' &&
      existingHold.status !== 'PARTIALLY_CAPTURED'
    ) {
      throw new HoldNotPendingError(cmd.holdId, existingHold.status);
    }

    const accountId = await bankingRepository.getAccountIdByNumber(
      existingHold.payerAccountNumber
    );
    if (!accountId) {
      throw new AccountNotFoundError(existingHold.payerAccountNumber);
    }

    const account = await bankingRepository.getAccountById(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    if (!account.isOwnedBy(cmd.userId)) {
      throw new ForbiddenError('Access denied to payer account');
    }
    account.ensureActive();

    const capturedAmountMinor = existingHold.capturedAmountMinor ?? 0;
    const releasableAmountMinor = Math.max(
      existingHold.amountMinor - capturedAmountMinor,
      0
    );
    if (releaseAmount.toCents() > releasableAmountMinor) {
      throw new IdempotencyConflictError(
        'Release amount exceeds remaining reserved amount'
      );
    }

    const updatedAmountMinor =
      existingHold.amountMinor - releaseAmount.toCents();
    const remainingReservedMinor = Math.max(
      updatedAmountMinor - capturedAmountMinor,
      0
    );

    const nextStatus: Hold['status'] =
      remainingReservedMinor === 0
        ? capturedAmountMinor > 0
          ? 'CAPTURED'
          : 'RELEASED'
        : capturedAmountMinor > 0
        ? 'PARTIALLY_CAPTURED'
        : 'PENDING';

    const releasedAt = clock().toISOString();
    const updatedHold: Hold = {
      ...existingHold,
      amountMinor: updatedAmountMinor,
      status: nextStatus,
      ...(nextStatus === 'RELEASED'
        ? {
            releasedAt,
            ...(cmd.reason ? { releaseReason: cmd.reason } : {}),
          }
        : {
            releasedAt: undefined,
            releaseReason: undefined,
          }),
    };

    const idempotencyKeyHash = hashIdempotencyKey(cmd.idempotencyKey);
    const request: PartialReleaseHoldRequest = {
      accountId: account.id,
      accountBalanceVersion: account.balanceVersion,
      availableBalanceMinor: account.availableBalanceMinor.toCents(),
      releaseAmountMinor: releaseAmount.toCents(),
      hold: updatedHold,
      holdEvent: {
        at: releasedAt,
        type: 'RELEASED',
        ...(cmd.reason ? { reason: cmd.reason } : {}),
        ...(cmd.payNoteDocumentId
          ? { payNoteDocumentId: cmd.payNoteDocumentId }
          : {}),
      },
      expectedAmountMinor: existingHold.amountMinor,
      expectedCapturedAmountMinor: capturedAmountMinor,
      idempotencyKey: cmd.idempotencyKey,
      idempotencyKeyHash,
      userId: cmd.userId,
    };

    const result: PartialReleaseHoldResult =
      await holdRepository.partialReleaseHold(request);

    const completedTiming = TimingUtils.endTiming(timing);
    metrics?.addMetric(
      METRIC_NAMES.BANKING?.RELEASE_HOLD_SUCCESS ?? 'ReleaseHoldSuccess',
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING?.RELEASE_HOLD_DURATION ?? 'ReleaseHoldDuration',
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration ?? 0
    );

    logger?.info('Partial release hold completed', {
      holdId: result.hold.holdId,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      amountMinor: cmd.amountMinor,
      nextStatus: result.hold.status,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return result.hold;
  } catch (error) {
    const failedTiming = TimingUtils.endTiming(timing);
    metrics?.addMetric(
      METRIC_NAMES.BANKING?.RELEASE_HOLD_ERROR ?? 'ReleaseHoldError',
      METRIC_UNITS.COUNT,
      1
    );
    logger?.error('Partial release hold failed', {
      holdId: cmd.holdId,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      amountMinor: cmd.amountMinor,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });
    throw error;
  }
}
