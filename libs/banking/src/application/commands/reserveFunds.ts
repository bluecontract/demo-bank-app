import { randomUUID } from 'crypto';
import { AccountNotFoundError, ForbiddenError } from '../errors';
import type { BankingRepository } from '../ports';
import type {
  HoldRepository,
  ReserveHoldRequest,
  ReserveHoldResult,
} from '../HoldRepository';
import { Money } from '../../domain/valueObjects/Money';
import type { Hold } from '../../domain/entities/Hold';
import {
  InvalidAccountError,
  InvalidMoneyAmountError,
} from '../../domain/errors';
import { hashIdempotencyKey } from '../../domain/idempotency';
import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  METRIC_UNITS,
  OPERATION_NAMES,
} from '@demo-bank-app/shared-observability';

export interface ReserveFundsCommand {
  userId: string;
  idempotencyKey: string;
  holdId?: string;
  payerAccountNumber: string;
  amountMinor: number;
  description?: string;
  counterpartyAccountNumber?: string;
}

export interface ReserveFundsDependencies {
  bankingRepository: BankingRepository;
  holdRepository: HoldRepository;
  logger?: Logger;
  metrics?: Metrics;
  idGenerator?: () => string;
  clock?: () => Date;
}

export async function reserveFunds(
  cmd: ReserveFundsCommand,
  deps: ReserveFundsDependencies
): Promise<Hold> {
  const {
    bankingRepository,
    holdRepository,
    logger,
    metrics,
    idGenerator = randomUUID,
    clock = () => new Date(),
  } = deps;

  const timing = TimingUtils.startTiming(
    OPERATION_NAMES.BANKING?.RESERVE_FUNDS ?? 'ReserveFunds'
  );

  logger?.info('Reserve funds started', {
    payerAccountNumber: cmd.payerAccountNumber,
    amountMinor: cmd.amountMinor,
    userId: cmd.userId,
    idempotencyKey: cmd.idempotencyKey,
    counterpartyAccountNumber: cmd.counterpartyAccountNumber,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const amount = new Money(cmd.amountMinor);
    if (!amount.isPositive()) {
      throw new InvalidMoneyAmountError(cmd.amountMinor);
    }

    const accountId = await bankingRepository.getAccountIdByNumber(
      cmd.payerAccountNumber
    );
    if (!accountId) {
      throw new AccountNotFoundError(cmd.payerAccountNumber);
    }

    const account = await bankingRepository.getAccountById(accountId);
    if (!account) {
      throw new AccountNotFoundError(accountId);
    }

    if (!account.isOwnedBy(cmd.userId)) {
      throw new ForbiddenError('Access denied to payer account');
    }

    account.ensureActive();

    if (account.currency !== 'USD') {
      throw new InvalidAccountError(
        'currency',
        'Account currency must be USD to reserve funds'
      );
    }

    account.ensureSufficientFunds(amount);

    const holdId = cmd.holdId ?? idGenerator();
    const now = clock();
    const createdAt = now.toISOString();
    const idempotencyKeyHash = hashIdempotencyKey(cmd.idempotencyKey);

    const hold: Hold = {
      holdId,
      payerAccountNumber: account.accountNumber,
      counterpartyAccountNumber: cmd.counterpartyAccountNumber,
      amountMinor: amount.toCents(),
      currency: account.currency,
      status: 'PENDING',
      description: cmd.description,
      createdAt,
    };

    const reserveRequest: ReserveHoldRequest = {
      accountId: account.id,
      accountBalanceVersion: account.balanceVersion,
      availableBalanceMinor: account.availableBalanceMinor.toCents(),
      amountMinor: amount.toCents(),
      hold,
      holdEvent: {
        at: createdAt,
        type: 'CREATED',
        createdByUserId: cmd.userId,
        idempotencyKeyHash,
      },
      idempotencyKey: cmd.idempotencyKey,
      idempotencyKeyHash,
      userId: cmd.userId,
    };

    const result: ReserveHoldResult = await holdRepository.reserveHold(
      reserveRequest
    );

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING?.RESERVE_FUNDS_SUCCESS ?? 'ReserveFundsSuccess',
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING?.RESERVE_FUNDS_DURATION ?? 'ReserveFundsDuration',
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration ?? 0
    );

    logger?.info('Reserve funds completed', {
      payerAccountNumber: cmd.payerAccountNumber,
      amountMinor: cmd.amountMinor,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      holdId: result.hold.holdId,
      created: result.created,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return result.hold;
  } catch (error) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Reserve funds failed', {
      payerAccountNumber: cmd.payerAccountNumber,
      amountMinor: cmd.amountMinor,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING?.RESERVE_FUNDS_ERROR ?? 'ReserveFundsError',
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
