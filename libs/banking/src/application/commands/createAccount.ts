import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { randomUUID } from 'crypto';
import type { Logger, Metrics } from '../../domain/types';
import {
  TimingUtils,
  METRIC_NAMES,
  OPERATION_NAMES,
  METRIC_UNITS,
} from '@demo-bank-app/shared-observability';
import type { BankingRepository, AccountNumberGenerator } from '../ports';
import { AccountResult } from '../dtos';

export interface CreateAccountCommand {
  ownerId: string;
  name: string;
  isTest?: boolean;
}

export interface CreateAccountDependencies {
  repository: BankingRepository;
  accountNumberGenerator: AccountNumberGenerator;
  logger?: Logger;
  metrics?: Metrics;
}

function toAccountResult(account: Account): AccountResult {
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
}

export async function createAccount(
  command: CreateAccountCommand,
  dependencies: CreateAccountDependencies
): Promise<AccountResult> {
  const { repository, accountNumberGenerator, logger, metrics } = dependencies;
  const { ownerId, name, isTest = false } = command;

  const timing = TimingUtils.startTiming(
    OPERATION_NAMES.BANKING.ACCOUNT_CREATE
  );

  logger?.info('Account creation started', {
    ownerId,
    name,
    isTest,
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const account = new Account({
      id: randomUUID(),
      accountNumber: accountNumberGenerator.generate(),
      name,
      ownerUserId: ownerId,
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date(),
      ledgerBalanceMinor: Money.ZERO,
      availableBalanceMinor: Money.ZERO,
      isTest,
      balanceVersion: 0,
    });

    const savedAccount = await repository.saveAccount(account);

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_CREATE,
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_CREATE_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration || 0
    );

    logger?.info('Account creation completed successfully', {
      ownerId,
      accountId: savedAccount.id,
      accountNumber: savedAccount.accountNumber,
      name,
      isTest,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return toAccountResult(savedAccount);
  } catch (error: unknown) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Account creation failed', {
      ownerId,
      name,
      isTest,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACCOUNT_CREATE_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
