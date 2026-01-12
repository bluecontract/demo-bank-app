import { randomUUID } from 'crypto';
import type { Card } from '../../domain/entities/Card';
import {
  CardIssuanceError,
  CardPanCollisionError,
  ForbiddenError,
} from '../errors';
import { generateCvc, generatePan } from '../../domain/cardUtils';
import type { BankingRepository } from '../ports';
import type { CardRepository } from '../CardRepository';
import type { CardHasher } from '../CardHasher';
import { AccountNotFoundError } from '../errors';

export interface IssueCardCommand {
  userId: string;
  accountId: string;
  cardholderName?: string;
  isTest?: boolean;
}

export interface IssueCardDependencies {
  bankingRepository: BankingRepository;
  cardRepository: CardRepository;
  cardHasher: CardHasher;
  binPrefix: string;
  idGenerator?: () => string;
  panGenerator?: (binPrefix: string) => string;
  cvcGenerator?: () => string;
  clock?: () => Date;
}

export interface IssuedCardResult {
  card: Card;
  pan: string;
  cvc: string;
}

const DEFAULT_MAX_ATTEMPTS = 5;

export async function issueCard(
  command: IssueCardCommand,
  deps: IssueCardDependencies
): Promise<IssuedCardResult> {
  const {
    bankingRepository,
    cardRepository,
    cardHasher,
    binPrefix,
    idGenerator = randomUUID,
    panGenerator = generatePan,
    cvcGenerator = generateCvc,
    clock = () => new Date(),
  } = deps;

  const account = await bankingRepository.getAccountById(command.accountId);
  if (!account) {
    throw new AccountNotFoundError(command.accountId);
  }
  if (!account.isOwnedBy(command.userId)) {
    throw new ForbiddenError('Access denied to issue card for this account');
  }

  const now = clock();
  const expiryMonth = now.getUTCMonth() + 1;
  const expiryYear = now.getUTCFullYear() + 3;
  const cardholderName = command.cardholderName ?? account.name;

  for (let attempt = 0; attempt < DEFAULT_MAX_ATTEMPTS; attempt += 1) {
    const pan = panGenerator(binPrefix);
    const cvc = cvcGenerator();
    const cardId = idGenerator();

    const card: Card = {
      cardId,
      accountId: account.id,
      accountNumber: account.accountNumber,
      ownerUserId: account.ownerUserId,
      cardholderName,
      panLast4: pan.slice(-4),
      panHash: cardHasher.hashPan(pan),
      cvcHash: cardHasher.hashCvc(cvc),
      expiryMonth,
      expiryYear,
      status: 'ACTIVE',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      isTest: command.isTest ?? false,
    };

    try {
      await cardRepository.createCard(card);
      return { card, pan, cvc };
    } catch (error) {
      if (error instanceof CardPanCollisionError) {
        continue;
      }
      throw error;
    }
  }

  throw new CardIssuanceError('Unable to issue unique card after retries');
}
