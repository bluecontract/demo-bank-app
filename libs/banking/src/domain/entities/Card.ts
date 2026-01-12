export type CardStatus = 'ACTIVE' | 'BLOCKED' | 'CLOSED' | 'EXPIRED';

export interface CardMerchant {
  name: string;
  statementDescriptor?: string;
  categoryCode?: string;
  country?: string;
}

export interface Card {
  cardId: string;
  accountId: string;
  accountNumber: string;
  ownerUserId: string;
  cardholderName: string;
  panLast4: string;
  panHash: string;
  cvcHash: string;
  expiryMonth: number;
  expiryYear: number;
  status: CardStatus;
  createdAt: string;
  updatedAt: string;
  isTest?: boolean;
}
