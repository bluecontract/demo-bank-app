import { randomUUID } from 'crypto';
import type { CardMerchant, Card } from '../../domain/entities/Card';
import type { Hold } from '../../domain/entities/Hold';
import {
  type CardTransactionDetails,
  generateCardTransactionDetails,
} from '../../domain/valueObjects/CardTransactionDetails';
import type { BankingRepository } from '../ports';
import type { CardRepository } from '../CardRepository';
import type { CardHasher } from '../CardHasher';
import type {
  HoldRepository,
  ReserveHoldRequest,
  ReserveHoldResult,
} from '../HoldRepository';
import { Money } from '../../domain/valueObjects/Money';
import {
  InvalidAccountError,
  InvalidMoneyAmountError,
  InsufficientFundsError,
} from '../../domain/errors';
import { hashIdempotencyKey } from '../../domain/idempotency';
import { AccountNotFoundError, IdempotencyConflictError } from '../errors';
import { CARD_PROCESSOR_USER_ID } from '../cardProcessorConstants';

export type CardDeclineCode =
  | 'card_not_found'
  | 'card_inactive'
  | 'expired_card'
  | 'invalid_cvc'
  | 'insufficient_funds'
  | 'invalid_amount'
  | 'invalid_currency';

export type CardAuthorizationResult =
  | {
      status: 'APPROVED';
      hold: Hold;
      card: Card;
    }
  | {
      status: 'DECLINED';
      declineCode: CardDeclineCode;
      message: string;
    };

export interface AuthorizeCardCommand {
  pan: string;
  expiryMonth: number;
  expiryYear: number;
  cvc: string;
  amountMinor: number;
  currency: 'USD' | string;
  merchant: CardMerchant;
  processorChargeId: string;
  description?: string;
  idempotencyKey: string;
}

export interface AuthorizeCardDependencies {
  bankingRepository: BankingRepository;
  cardRepository: CardRepository;
  holdRepository: HoldRepository;
  cardHasher: CardHasher;
  idGenerator?: () => string;
  clock?: () => Date;
  cardTransactionDetailsGenerator?: () => CardTransactionDetails;
}

export async function authorizeCard(
  command: AuthorizeCardCommand,
  deps: AuthorizeCardDependencies
): Promise<CardAuthorizationResult> {
  const {
    bankingRepository,
    cardRepository,
    holdRepository,
    cardHasher,
    idGenerator = randomUUID,
    clock = () => new Date(),
    cardTransactionDetailsGenerator = () =>
      generateCardTransactionDetails(clock),
  } = deps;

  if (command.amountMinor <= 0) {
    return {
      status: 'DECLINED',
      declineCode: 'invalid_amount',
      message: 'Amount must be greater than zero',
    };
  }

  if (command.currency !== 'USD') {
    return {
      status: 'DECLINED',
      declineCode: 'invalid_currency',
      message: 'Currency not supported',
    };
  }

  const panHash = cardHasher.hashPan(command.pan);
  const card = await cardRepository.getCardByPanHash(panHash);
  if (!card) {
    return {
      status: 'DECLINED',
      declineCode: 'card_not_found',
      message: 'Card not found',
    };
  }

  if (card.status !== 'ACTIVE') {
    return {
      status: 'DECLINED',
      declineCode: 'card_inactive',
      message: 'Card is not active',
    };
  }

  if (
    card.expiryMonth !== command.expiryMonth ||
    card.expiryYear !== command.expiryYear
  ) {
    return {
      status: 'DECLINED',
      declineCode: 'card_not_found',
      message: 'Card not found',
    };
  }

  const now = clock();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (
    card.expiryYear < currentYear ||
    (card.expiryYear === currentYear && card.expiryMonth < currentMonth)
  ) {
    return {
      status: 'DECLINED',
      declineCode: 'expired_card',
      message: 'Card has expired',
    };
  }

  const cvcHash = cardHasher.hashCvc(command.cvc);
  if (cvcHash !== card.cvcHash) {
    return {
      status: 'DECLINED',
      declineCode: 'invalid_cvc',
      message: 'Invalid CVC',
    };
  }

  const account = await bankingRepository.getAccountById(card.accountId);
  if (!account) {
    throw new AccountNotFoundError(card.accountId);
  }

  account.ensureActive();

  try {
    account.ensureSufficientFunds(new Money(command.amountMinor));
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      return {
        status: 'DECLINED',
        declineCode: 'insufficient_funds',
        message: 'Insufficient funds',
      };
    }
    throw error;
  }

  if (account.currency !== 'USD') {
    throw new InvalidAccountError(
      'currency',
      'Account currency must be USD to authorize card'
    );
  }

  const holdId = idGenerator();
  const createdAt = now.toISOString();
  const idempotencyKeyHash = hashIdempotencyKey(command.idempotencyKey);

  const hold: Hold = {
    holdId,
    payerAccountNumber: account.accountNumber,
    amountMinor: command.amountMinor,
    currency: 'USD',
    status: 'PENDING',
    description: command.description ?? command.merchant.name,
    createdAt,
    cardId: card.cardId,
    cardLast4: card.panLast4,
    merchantName: command.merchant.name,
    merchantStatementDescriptor: command.merchant.statementDescriptor,
    processorChargeId: command.processorChargeId,
    cardTransactionDetails: cardTransactionDetailsGenerator(),
  };

  const reserveRequest: ReserveHoldRequest = {
    accountId: account.id,
    accountBalanceVersion: account.balanceVersion,
    availableBalanceMinor: account.availableBalanceMinor.toCents(),
    amountMinor: command.amountMinor,
    hold,
    holdEvent: {
      at: createdAt,
      type: 'CREATED',
      createdByUserId: CARD_PROCESSOR_USER_ID,
      idempotencyKeyHash,
    },
    idempotencyKey: command.idempotencyKey,
    idempotencyKeyHash,
    userId: CARD_PROCESSOR_USER_ID,
  };

  let result: ReserveHoldResult;
  try {
    result = await holdRepository.reserveHold(reserveRequest);
  } catch (error) {
    if (error instanceof InvalidMoneyAmountError) {
      return {
        status: 'DECLINED',
        declineCode: 'invalid_amount',
        message: error.message,
      };
    }
    if (error instanceof InsufficientFundsError) {
      return {
        status: 'DECLINED',
        declineCode: 'insufficient_funds',
        message: error.message,
      };
    }
    throw error;
  }

  await holdRepository.ensureCardTransactionMapping(result.hold);

  if (!result.created) {
    const existing = result.hold;
    const mismatch =
      existing.amountMinor !== hold.amountMinor ||
      existing.cardId !== hold.cardId ||
      existing.cardLast4 !== hold.cardLast4 ||
      existing.processorChargeId !== hold.processorChargeId ||
      existing.merchantName !== hold.merchantName ||
      existing.merchantStatementDescriptor !== hold.merchantStatementDescriptor;

    if (mismatch) {
      throw new IdempotencyConflictError(
        'Authorization idempotency key reused with different payload'
      );
    }
  }

  return {
    status: 'APPROVED',
    hold: result.hold,
    card,
  };
}
