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
  PartialCaptureHoldRequest,
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

  if (hold.status === 'CAPTURED') {
    if (hold.amountMinor !== command.amountMinor) {
      throw new IdempotencyConflictError(
        'Capture already processed with different amount'
      );
    }
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

  const capturedAmountMinor = hold.capturedAmountMinor ?? 0;
  const remainingAmountMinor = hold.amountMinor - capturedAmountMinor;

  if (command.amountMinor > remainingAmountMinor) {
    throw new IdempotencyConflictError(
      'Capture amount exceeds remaining authorized amount'
    );
  }

  if (hold.status !== 'PENDING' && hold.status !== 'PARTIALLY_CAPTURED') {
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

  const captureAmount = new Money(command.amountMinor);

  const debit = new Posting({
    accountId: payerAccount.id,
    amount: captureAmount,
    side: 'DEBIT',
    accountNumber: payerAccount.accountNumber,
    counterpartyAccountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
  });

  const credit = new Posting({
    accountId: settlementAccount.id,
    amount: captureAmount,
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

  const isInitialFullCapture =
    hold.status === 'PENDING' && command.amountMinor === hold.amountMinor;

  if (isInitialFullCapture) {
    const updatedHold = {
      ...hold,
      status: 'CAPTURED' as const,
      capturedAmountMinor: hold.amountMinor,
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
        amountMinor: hold.amountMinor,
        remainingAmountMinor: 0,
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

  const updatedCapturedAmount = capturedAmountMinor + command.amountMinor;
  const remainingAfterCapture = Math.max(
    hold.amountMinor - updatedCapturedAmount,
    0
  );
  const fullyCaptured = updatedCapturedAmount >= hold.amountMinor;

  const updatedStatus: 'CAPTURED' | 'PARTIALLY_CAPTURED' = fullyCaptured
    ? 'CAPTURED'
    : 'PARTIALLY_CAPTURED';

  const updatedHold = {
    ...hold,
    status: updatedStatus,
    capturedAmountMinor: updatedCapturedAmount,
    counterpartyAccountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
    relatedTransactionId: transaction.id,
  };

  const holdEvent = fullyCaptured
    ? {
        at: capturedAtIso,
        type: 'CAPTURED' as const,
        transactionId: transaction.id,
        counterpartyAccountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
        amountMinor: command.amountMinor,
        remainingAmountMinor: remainingAfterCapture,
      }
    : {
        at: capturedAtIso,
        type: 'CAPTURED_PARTIAL' as const,
        transactionId: transaction.id,
        counterpartyAccountNumber: CARD_SETTLEMENT.ACCOUNT_NUMBER,
        amountMinor: command.amountMinor,
        remainingAmountMinor: remainingAfterCapture,
      };

  const partialCaptureRequest: PartialCaptureHoldRequest = {
    payerAccountId: payerAccount.id,
    payerAccountBalanceVersion: payerAccount.balanceVersion,
    counterpartyAccountId: settlementAccount.id,
    counterpartyAccountBalanceVersion: settlementAccount.balanceVersion,
    hold: updatedHold,
    holdEvent,
    transaction,
    captureAmountMinor: command.amountMinor,
    idempotencyKey: command.idempotencyKey,
    idempotencyKeyHash,
    userId: CARD_PROCESSOR_USER_ID,
  };

  const result = await holdRepository.partialCaptureHold(partialCaptureRequest);

  return {
    status: 'CAPTURED',
    holdId: result.hold.holdId,
    transactionId: result.transactionId,
  };
}
