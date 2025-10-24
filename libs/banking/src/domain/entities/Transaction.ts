import { Posting, PostingSide } from '../valueObjects/Posting';
import { Money } from '../valueObjects/Money';
import { UnbalancedTransactionError, InvalidTransactionError } from '../errors';
import { randomUUID } from 'crypto';
import { FUNDING_SOURCE } from './Account';

export type TransactionType = 'FUNDING' | 'TRANSFER';
export type TransactionStatus = 'POSTED';

export interface TransactionProps {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  postings: Posting[];
  description: string;
  transactionIdempotencyKey?: string;
  createdAt: Date;
  originHoldId?: string;
}

export interface TransactionMeta {
  description: string;
  idempotencyKey?: string;
  originHoldId?: string;
}

export interface NetAmount {
  amount: Money;
  side: PostingSide;
}
export class Transaction {
  readonly id: string;
  readonly type: TransactionType;
  readonly status: TransactionStatus;
  readonly postings: Posting[];
  readonly description: string;
  readonly transactionIdempotencyKey?: string;
  readonly createdAt: Date;
  readonly originHoldId?: string;

  constructor(props: TransactionProps) {
    if (!props.id || props.id.trim() === '') {
      throw new InvalidTransactionError('id', 'Transaction ID cannot be empty');
    }

    if (!props.postings || props.postings.length === 0) {
      throw new InvalidTransactionError(
        'postings',
        'Transaction must have at least one posting'
      );
    }

    this.id = props.id;
    this.type = props.type;
    this.status = props.status;
    this.description = props.description;
    this.postings = [...props.postings];
    this.transactionIdempotencyKey = props.transactionIdempotencyKey;
    this.createdAt = props.createdAt;
    this.originHoldId = props.originHoldId;

    this.validateDoubleEntry();
  }

  static create(postings: Posting[], meta: TransactionMeta): Transaction {
    return Transaction.createWithId(postings, meta, randomUUID());
  }

  static createWithId(
    postings: Posting[],
    meta: TransactionMeta,
    id: string
  ): Transaction {
    return Transaction.buildTransaction(postings, meta, id);
  }

  private static buildTransaction(
    postings: Posting[],
    meta: TransactionMeta,
    id: string
  ): Transaction {
    const sum = postings.reduce((total, posting) => {
      return (
        total +
        (posting.side === 'DEBIT' ? posting.amountMinor : -posting.amountMinor)
      );
    }, 0);

    if (sum !== 0) {
      throw new UnbalancedTransactionError();
    }

    const transactionType: TransactionType = postings.some(
      p => p.accountId === FUNDING_SOURCE.ACCOUNT_ID
    )
      ? 'FUNDING'
      : 'TRANSFER';

    return new Transaction({
      id,
      type: transactionType,
      status: 'POSTED',
      postings,
      description: meta.description,
      transactionIdempotencyKey: meta.idempotencyKey,
      createdAt: new Date(),
      originHoldId: meta.originHoldId,
    });
  }

  private validateDoubleEntry(): void {
    const debits = this.postings
      .filter(p => p.side === 'DEBIT')
      .reduce((sum, p) => sum + p.amount.toCents(), 0);

    const credits = this.postings
      .filter(p => p.side === 'CREDIT')
      .reduce((sum, p) => sum + p.amount.toCents(), 0);

    if (debits !== credits) {
      throw new InvalidTransactionError(
        'postings',
        `Transaction debits (${debits}) must equal credits (${credits})`
      );
    }

    if (debits === 0 || credits === 0) {
      throw new InvalidTransactionError(
        'postings',
        'Transaction must have both debit and credit postings'
      );
    }
  }

  equals(other: Transaction): boolean {
    if (
      this.id !== other.id ||
      this.type !== other.type ||
      this.status !== other.status ||
      this.transactionIdempotencyKey !== other.transactionIdempotencyKey ||
      this.createdAt.getTime() !== other.createdAt.getTime() ||
      this.originHoldId !== other.originHoldId ||
      this.postings.length !== other.postings.length
    ) {
      return false;
    }

    for (let i = 0; i < this.postings.length; i++) {
      if (!this.postings[i].equals(other.postings[i])) {
        return false;
      }
    }

    return true;
  }
}
