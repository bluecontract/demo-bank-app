import { Money } from './Money';

export type PostingSide = 'DEBIT' | 'CREDIT';
export type Side = PostingSide;

export interface PostingProps {
  accountId: string;
  amount: Money;
  side: PostingSide;
  accountNumber: string;
  counterpartyAccountNumber: string;
}
export class Posting {
  readonly accountId: string;
  readonly amount: Money;
  readonly side: PostingSide;
  readonly accountNumber: string;
  readonly counterpartyAccountNumber: string;

  constructor(props: PostingProps) {
    if (!props.accountId || props.accountId.trim() === '') {
      throw new Error('Account ID cannot be empty');
    }

    if (!props.accountNumber || props.accountNumber.trim() === '') {
      throw new Error('Account number cannot be empty');
    }

    if (
      !props.counterpartyAccountNumber ||
      props.counterpartyAccountNumber.trim() === ''
    ) {
      throw new Error('Counterparty account number cannot be empty');
    }

    if (!props.amount.isPositive()) {
      throw new Error('Amount must be positive');
    }

    this.accountId = props.accountId;
    this.amount = props.amount;
    this.side = props.side;
    this.accountNumber = props.accountNumber;
    this.counterpartyAccountNumber = props.counterpartyAccountNumber;
  }

  get amountMinor(): number {
    return this.amount.toCents();
  }

  equals(other: Posting): boolean {
    return (
      this.accountId === other.accountId &&
      this.amount.equals(other.amount) &&
      this.side === other.side &&
      this.accountNumber === other.accountNumber &&
      this.counterpartyAccountNumber === other.counterpartyAccountNumber
    );
  }
}
