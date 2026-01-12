import type { Card } from '../../domain/entities/Card';
import type { CardRepository } from '../CardRepository';
import { CardNotFoundError, ForbiddenError } from '../errors';

export interface GetCardCommand {
  userId: string;
  cardId: string;
}

export interface GetCardDependencies {
  cardRepository: CardRepository;
}

export async function getCard(
  command: GetCardCommand,
  deps: GetCardDependencies
): Promise<Card> {
  const { cardRepository } = deps;
  const card = await cardRepository.getCardById(command.cardId);
  if (!card) {
    throw new CardNotFoundError(command.cardId);
  }
  if (card.ownerUserId !== command.userId) {
    throw new ForbiddenError('Access denied to card');
  }
  return card;
}
