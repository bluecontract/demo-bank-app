import { randomUUID } from 'crypto';
import {
  AccountNotFoundError,
  HoldCaptureDisabledError,
  HoldNotFoundError,
  HoldNotPendingError,
} from '../errors';
import { IdempotencyConflictError } from '../errors';
import type { BankingRepository } from '../ports';
import type {
  HoldRepository,
  CaptureHoldRequest,
  CaptureHoldResult,
} from '../HoldRepository';
import { CARD_SETTLEMENT } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { Posting } from '../../domain/valueObjects/Posting';
import { Transaction } from '../../domain/entities/Transaction';
import { hashIdempotencyKey } from '../../domain/idempotency';
import { CARD_PROCESSOR_USER_ID } from '../cardProcessorConstants';

export interface CaptureCardAuthorizationCommand {
  authorizationId: string;
  amountMinor: number;
  idempotencyKey: string;
}

export interface CaptureCardAuthorizationDependencies {
  bankingRepository: BankingRepository;
  holdRepository: HoldRepository;
  clock?: () => Date;
  transactionIdGenerator?: () => string;
}

export interface CaptureCardAuthorizationResult {
  holdId: string;
  transactionId: string;
  status: 'CAPTURED';
}

export async function captureCardAuthorization(
  command: CaptureCardAuthorizationCommand,
  deps: CaptureCardAuthorizationDependencies
): Promise<CaptureCardAuthorizationResult> {
  const {
    bankingRepository,
    holdRepository,
    clock = () => new Date(),
    transactionIdGenerator = randomUUID,
  } = deps;

  const hold = await holdRepository.getHold(command.authorizationId);
  if (!hold) {
    throw new HoldNotFoundError(command.authorizationId);
  }

  if (hold.amountMinor !== command.amountMinor) {
    throw new IdempotencyConflictError(
      'Capture amount does not match authorized amount'
    );
  }

  if (hold.status === 'CAPTURED') {
    if (!hold.relatedTransactionId) {
      throw new IdempotencyConflictError(
        'Capture already processed without transaction reference'
      );
    }
    return {
      status: 'CAPTURED',
      holdId: hold.holdId,
      transactionId: hold.relatedTransactionId,
    };
  }

  if (hold.status !== 'PENDING') {
    throw new HoldNotPendingError(hold.holdId, hold.status);
  }

  if (hold.captureDisabled) {
    throw new HoldCaptureDisabledError(hold.holdId);
  }

  const payerAccountId = await bankingRepository.getAccountIdByNumber(
    hold.payerAccountNumber
  );
  if (!payerAccountId) {
    throw new AccountNotFoundError(hold.payerAccountNumber);
  }

  const [payerAccount, settlementAccount] = await Promise.all([
    bankingRepository.getAccountById(payerAccountId),
    bankingRepository.getAccountById(CARD_SETTLEMENT.ACCOUNT_ID),
  ]);

  if (!payerAccount) {
    throw new AccountNotFoundError(payerAccountId);
  }
  if (!settlementAccount) {
    throw new AccountNotFoundError(CARD_SETTLEMENT.ACCOUNT_ID);
  }

  payerAccount.ensureActive();
  settlementAccount.ensureActive();

  const amount = new Money(hold.amountMinor);

  const debit = new Posting({
    accountId: payerAccount.id,
    amount,
    side: 'DEBIT',
    accountNumber: payerAccount.accountNumber,
    counterpartyAccountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
  });

  const credit = new Posting({
    accountId: settlementAccount.id,
    amount,
    side: 'CREDIT',
    accountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
    counterpartyAccountNumber: payerAccount.accountNumber,
  });

  payerAccount.applyPosting(debit);
  settlementAccount.applyPosting(credit);

  const capturedAt = clock();
  const capturedAtIso = capturedAt.toISOString();

  const transactionId = transactionIdGenerator();
  const transaction = Transaction.createWithId(
    [debit, credit],
    {
      idempotencyKey: command.idempotencyKey,
      description: hold.description ?? 'Card purchase capture',
      createdAt: capturedAt,
      originHoldId: hold.holdId,
      cardId: hold.cardId,
      cardLast4: hold.cardLast4,
      merchantName: hold.merchantName,
      merchantId: hold.merchantId,
      merchantStatementDescriptor: hold.merchantStatementDescriptor,
      processorChargeId: hold.processorChargeId,
    },
    transactionId
  );
  const idempotencyKeyHash = hashIdempotencyKey(command.idempotencyKey);

  const updatedHold = {
    ...hold,
    status: 'CAPTURED' as const,
    counterpartyAccountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
    relatedTransactionId: transaction.id,
  };

  const captureRequest: CaptureHoldRequest = {
    payerAccountId: payerAccount.id,
    payerAccountBalanceVersion: payerAccount.balanceVersion,
    counterpartyAccountId: settlementAccount.id,
    counterpartyAccountBalanceVersion: settlementAccount.balanceVersion,
    hold: updatedHold,
    holdEvent: {
      at: capturedAtIso,
      type: 'CAPTURED',
      transactionId: transaction.id,
      counterpartyAccountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
    },
    transaction,
    idempotencyKey: command.idempotencyKey,
    idempotencyKeyHash,
    userId: CARD_PROCESSOR_USER_ID,
  };

  const result: CaptureHoldResult = await holdRepository.captureHold(
    captureRequest
  );

  return {
    status: 'CAPTURED',
    holdId: result.hold.holdId,
    transactionId: result.transactionId,
  };
}
