import { hashIdempotencyKey } from '../../domain/idempotency';
import type { Hold } from '../../domain/entities/Hold';
import {
  AccountNotFoundError,
  ForbiddenError,
  HoldNotFoundError,
  HoldNotPendingError,
} from '../errors';
import type { BankingRepository } from '../ports';
import type {
  HoldRepository,
  ReleaseHoldRequest,
  ReleaseHoldResult,
} from '../HoldRepository';
import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  METRIC_UNITS,
  OPERATION_NAMES,
} from '@demo-bank-app/shared-observability';

export interface ReleaseHoldCommand {
  holdId: Hold['holdId'];
  userId: string;
  idempotencyKey: string;
  reason?: string;
}

export interface ReleaseHoldDependencies {
  holdRepository: HoldRepository;
  bankingRepository: BankingRepository;
  logger?: Logger;
  metrics?: Metrics;
  clock?: () => Date;
}

export async function releaseHold(
  cmd: ReleaseHoldCommand,
  deps: ReleaseHoldDependencies
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

  logger?.info('Release hold started', {
    holdId: cmd.holdId,
    userId: cmd.userId,
    idempotencyKey: cmd.idempotencyKey,
    reason: cmd.reason,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const existingHold = await holdRepository.getHold(cmd.holdId);
    if (!existingHold) {
      throw new HoldNotFoundError(cmd.holdId);
    }

    if (existingHold.status === 'RELEASED') {
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

      logger?.info('Release hold completed (idempotent)', {
        holdId: existingHold.holdId,
        userId: cmd.userId,
        idempotencyKey: cmd.idempotencyKey,
        created: false,
        ...TimingUtils.createTimingMetadata(completedTiming),
      });

      return existingHold;
    }

    if (existingHold.status !== 'PENDING') {
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

    const releasedAt = clock().toISOString();
    const updatedHold: Hold = {
      ...existingHold,
      status: 'RELEASED',
      releasedAt,
      ...(cmd.reason ? { releaseReason: cmd.reason } : {}),
    };

    const idempotencyKeyHash = hashIdempotencyKey(cmd.idempotencyKey);

    const releaseRequest: ReleaseHoldRequest = {
      accountId: account.id,
      accountBalanceVersion: account.balanceVersion,
      availableBalanceMinor: account.availableBalanceMinor.toCents(),
      amountMinor: existingHold.amountMinor,
      hold: updatedHold,
      holdEvent: {
        at: releasedAt,
        type: 'RELEASED',
        ...(cmd.reason ? { reason: cmd.reason } : {}),
      },
      idempotencyKey: cmd.idempotencyKey,
      idempotencyKeyHash,
      userId: cmd.userId,
    };

    const result: ReleaseHoldResult = await holdRepository.releaseHold(
      releaseRequest
    );

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

    logger?.info('Release hold completed', {
      holdId: result.hold.holdId,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      created: result.created,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return result.hold;
  } catch (error) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Release hold failed', {
      holdId: cmd.holdId,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING?.RELEASE_HOLD_ERROR ?? 'ReleaseHoldError',
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
