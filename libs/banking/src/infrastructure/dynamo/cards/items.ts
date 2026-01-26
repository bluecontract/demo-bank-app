import type { Card } from '../../../domain/entities/Card';
import type { CardSummary } from '../../../application/CardRepository';

const CARD_TABLE_PREFIXES = {
  CARD: 'CARD#',
  ACCOUNT: 'ACCOUNT#',
  PAN: 'CARD_PAN#',
} as const;

const CARD_SORT_KEYS = {
  META: 'META',
  LOOKUP: 'LOOKUP',
} as const;

const CARD_INDEX_SORT_KEY_PREFIX = 'CARD#';

export interface CardMetaItem {
  PK: string;
  SK: typeof CARD_SORT_KEYS.META;
  cardId: string;
  accountId: string;
  accountNumber: string;
  ownerUserId: string;
  cardholderName: string;
  pan: string;
  cvc: string;
  panLast4: string;
  panHash: string;
  cvcHash: string;
  expiryMonth: number;
  expiryYear: number;
  status: Card['status'];
  createdAt: string;
  updatedAt: string;
  isTest?: boolean;
  ttl?: number;
}

export interface CardAccountIndexItem {
  PK: string;
  SK: string;
  cardId: string;
  accountId: string;
  accountNumber: string;
  ownerUserId: string;
  cardholderName: string;
  panLast4: string;
  expiryMonth: number;
  expiryYear: number;
  status: Card['status'];
  createdAt: string;
  updatedAt: string;
  isTest?: boolean;
  ttl?: number;
}

export interface CardPanLookupItem {
  PK: string;
  SK: typeof CARD_SORT_KEYS.LOOKUP;
  cardId: string;
  accountId: string;
  accountNumber: string;
  ownerUserId: string;
  status: Card['status'];
  expiryMonth: number;
  expiryYear: number;
  panLast4: string;
  ttl?: number;
}

export function buildCardPartitionKey(cardId: Card['cardId']): string {
  return `${CARD_TABLE_PREFIXES.CARD}${cardId}`;
}

export function buildCardAccountPartitionKey(
  accountId: Card['accountId']
): string {
  return `${CARD_TABLE_PREFIXES.ACCOUNT}${accountId}`;
}

export function buildCardAccountSortKey(card: Card): string {
  return `${CARD_INDEX_SORT_KEY_PREFIX}${card.createdAt}#${card.cardId}`;
}

export function buildCardPanPartitionKey(panHash: Card['panHash']): string {
  return `${CARD_TABLE_PREFIXES.PAN}${panHash}`;
}

export function buildCardMetaItem(
  card: Card,
  options?: { ttl?: number }
): CardMetaItem {
  return {
    PK: buildCardPartitionKey(card.cardId),
    SK: CARD_SORT_KEYS.META,
    cardId: card.cardId,
    accountId: card.accountId,
    accountNumber: card.accountNumber,
    ownerUserId: card.ownerUserId,
    cardholderName: card.cardholderName,
    pan: card.pan,
    cvc: card.cvc,
    panLast4: card.panLast4,
    panHash: card.panHash,
    cvcHash: card.cvcHash,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    status: card.status,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    isTest: card.isTest,
    ...(options?.ttl ? { ttl: options.ttl } : {}),
  };
}

export function buildCardAccountIndexItem(
  card: Card,
  options?: { ttl?: number }
): CardAccountIndexItem {
  return {
    PK: buildCardAccountPartitionKey(card.accountId),
    SK: buildCardAccountSortKey(card),
    cardId: card.cardId,
    accountId: card.accountId,
    accountNumber: card.accountNumber,
    ownerUserId: card.ownerUserId,
    cardholderName: card.cardholderName,
    panLast4: card.panLast4,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    status: card.status,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    isTest: card.isTest,
    ...(options?.ttl ? { ttl: options.ttl } : {}),
  };
}

export function buildCardPanLookupItem(
  card: Card,
  options?: { ttl?: number }
): CardPanLookupItem {
  return {
    PK: buildCardPanPartitionKey(card.panHash),
    SK: CARD_SORT_KEYS.LOOKUP,
    cardId: card.cardId,
    accountId: card.accountId,
    accountNumber: card.accountNumber,
    ownerUserId: card.ownerUserId,
    status: card.status,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    panLast4: card.panLast4,
    ...(options?.ttl ? { ttl: options.ttl } : {}),
  };
}

export function mapCardMetaItemToCard(item: CardMetaItem): Card {
  return {
    cardId: item.cardId,
    accountId: item.accountId,
    accountNumber: item.accountNumber,
    ownerUserId: item.ownerUserId,
    cardholderName: item.cardholderName,
    pan: item.pan,
    cvc: item.cvc,
    panLast4: item.panLast4,
    panHash: item.panHash,
    cvcHash: item.cvcHash,
    expiryMonth: item.expiryMonth,
    expiryYear: item.expiryYear,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isTest: item.isTest,
  };
}

export function mapCardAccountItemToSummary(
  item: CardAccountIndexItem
): CardSummary {
  return {
    cardId: item.cardId,
    accountId: item.accountId,
    accountNumber: item.accountNumber,
    cardholderName: item.cardholderName,
    panLast4: item.panLast4,
    expiryMonth: item.expiryMonth,
    expiryYear: item.expiryYear,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export const CARD_ITEM_CONSTANTS = {
  TABLE_PREFIXES: CARD_TABLE_PREFIXES,
  SORT_KEYS: CARD_SORT_KEYS,
  ACCOUNT_CARD_PREFIX: CARD_INDEX_SORT_KEY_PREFIX,
} as const;
