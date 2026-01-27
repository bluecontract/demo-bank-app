export type CardStatus = 'ACTIVE' | 'BLOCKED' | 'CLOSED' | 'EXPIRED';

export interface CardMerchant {
  name: string;
  merchantId?: string;
  statementDescriptor?: string;
}

export interface Card {
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
  status: CardStatus;
  createdAt: string;
  updatedAt: string;
  isTest?: boolean;
}
