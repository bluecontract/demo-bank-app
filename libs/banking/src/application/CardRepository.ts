import type { Card } from '../domain/entities/Card';
import type { PaginationOptions, PaginatedResult } from '../domain/types';

export interface CardSummary {
  cardId: string;
  accountId: string;
  accountNumber: string;
  cardholderName: string;
  panLast4: string;
  expiryMonth: number;
  expiryYear: number;
  status: Card['status'];
  createdAt: string;
  updatedAt: string;
}

export interface CardRepository {
  createCard(card: Card): Promise<void>;
  getCardById(cardId: Card['cardId']): Promise<Card | null>;
  getCardByPanHash(panHash: Card['panHash']): Promise<Card | null>;
  listCardsByAccountId(
    accountId: Card['accountId'],
    options?: PaginationOptions
  ): Promise<PaginatedResult<CardSummary>>;
}
