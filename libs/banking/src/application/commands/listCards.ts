import type { CardRepository, CardSummary } from '../CardRepository';
import type { BankingRepository } from '../ports';
import { AccountNotFoundError, ForbiddenError } from '../errors';

export interface ListCardsCommand {
  userId: string;
  accountId?: string;
}

export interface ListCardsDependencies {
  bankingRepository: BankingRepository;
  cardRepository: CardRepository;
}

export async function listCards(
  command: ListCardsCommand,
  deps: ListCardsDependencies
): Promise<CardSummary[]> {
  const { bankingRepository, cardRepository } = deps;

  if (command.accountId) {
    const account = await bankingRepository.getAccountById(command.accountId);
    if (!account) {
      throw new AccountNotFoundError(command.accountId);
    }
    if (!account.isOwnedBy(command.userId)) {
      throw new ForbiddenError('Access denied to cards for this account');
    }

    const result = await cardRepository.listCardsByAccountId(account.id);
    return result.items;
  }

  const accounts = await bankingRepository.getAccountsByUserId(command.userId);
  const cardLists = await Promise.all(
    accounts.map(account => cardRepository.listCardsByAccountId(account.id))
  );

  return cardLists
    .flatMap(result => result.items)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
