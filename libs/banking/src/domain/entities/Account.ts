import { AccountInactiveError, InsufficientFundsError } from '../errors';
import { Posting } from '../valueObjects/Posting';
import { Money } from '../valueObjects/Money';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type Currency = 'USD';
export const FUNDING_SOURCE = {
  ACCOUNT_ID: 'FUNDING_SOURCE',
  ACCOUNT_NUMBER: '0000000000',
};

export interface AccountProps {
  id: string;
  accountNumber: string;
  name: string;
  ownerUserId: string;
  status: AccountStatus;
  currency: Currency;
  createdAt: Date;
  isTest?: boolean;
  ledgerBalanceMinor: Money;
  availableBalanceMinor: Money;
  balanceVersion: number;
}

export class Account {
  readonly id: string;
  readonly accountNumber: string;
  readonly name: string;
  readonly ownerUserId: string;
  readonly status: AccountStatus;
  readonly currency: Currency;
  readonly createdAt: Date;
  readonly isTest: boolean;
  public ledgerBalanceMinor: Money;
  public availableBalanceMinor: Money;
  public balanceVersion: number;

  private _deltaLedgerMinor = 0;
  private _deltaAvailableMinor = 0;

  constructor(props: AccountProps) {
    if (!props.id || props.id.trim() === '') {
      throw new Error('Account ID cannot be empty');
    }

    if (!props.accountNumber || props.accountNumber.trim() === '') {
      throw new Error('Account number cannot be empty');
    }

    if (!props.name || props.name.trim() === '') {
      throw new Error('Account name cannot be empty');
    }

    if (props.name.length > 100) {
      throw new Error('Account name must be 100 characters or less');
    }

    if (!props.ownerUserId || props.ownerUserId.trim() === '') {
      throw new Error('Owner user ID cannot be empty');
    }

    // Validate account number is exactly 10 digits
    if (!/^\d{10}$/.test(props.accountNumber)) {
      throw new Error('Account number must be exactly 10 digits');
    }

    // Validate required balance and version fields
    if (!props.ledgerBalanceMinor) {
      throw new Error('Ledger balance must be provided');
    }

    if (!props.availableBalanceMinor) {
      throw new Error('Available balance must be provided');
    }

    if (typeof props.balanceVersion !== 'number' || props.balanceVersion < 0) {
      throw new Error('Balance version must be a non-negative number');
    }

    this.id = props.id;
    this.accountNumber = props.accountNumber;
    this.name = props.name;
    this.ownerUserId = props.ownerUserId;
    this.status = props.status;
    this.currency = props.currency;
    this.createdAt = props.createdAt;
    this.isTest = props.isTest ?? false;
    this.ledgerBalanceMinor = props.ledgerBalanceMinor;
    this.availableBalanceMinor = props.availableBalanceMinor;
    this.balanceVersion = props.balanceVersion;
  }

  isActive(): boolean {
    return this.status === 'ACTIVE' || this.isFundingSource();
  }

  ensureActive(): void {
    if (!this.isActive()) {
      throw new AccountInactiveError(this.id);
    }
  }

  isOwnedBy(userId: string): boolean {
    return this.ownerUserId === userId || this.isFundingSource();
  }

  ensureSufficientFunds(amountMinor: number): void {
    if (this.isFundingSource()) {
      return;
    }

    if (this.availableBalanceMinor.isLessThan(new Money(amountMinor))) {
      throw new InsufficientFundsError(
        amountMinor,
        this.availableBalanceMinor.toCents()
      );
    }
  }

  applyPosting(posting: Posting): void {
    if (this.isFundingSource()) {
      return; // funding source is not affected by postings
    }

    if (posting.side === 'DEBIT') {
      this._deltaLedgerMinor -= posting.amountMinor;
      this._deltaAvailableMinor -= posting.amountMinor;
    } else {
      this._deltaLedgerMinor += posting.amountMinor;
      this._deltaAvailableMinor += posting.amountMinor;
    }
  }

  get pendingDelta(): { ledger: number; available: number } {
    return {
      ledger: this._deltaLedgerMinor,
      available: this._deltaAvailableMinor,
    };
  }

  flushPendingDelta(): void {
    if (this._deltaLedgerMinor > 0) {
      this.ledgerBalanceMinor = this.ledgerBalanceMinor.add(
        new Money(this._deltaLedgerMinor)
      );
    } else if (this._deltaLedgerMinor < 0) {
      this.ledgerBalanceMinor = this.ledgerBalanceMinor.subtract(
        new Money(-this._deltaLedgerMinor)
      );
    }
    if (this._deltaAvailableMinor > 0) {
      this.availableBalanceMinor = this.availableBalanceMinor.add(
        new Money(this._deltaAvailableMinor)
      );
    } else if (this._deltaAvailableMinor < 0) {
      this.availableBalanceMinor = this.availableBalanceMinor.subtract(
        new Money(-this._deltaAvailableMinor)
      );
    }
    this._deltaLedgerMinor = 0;
    this._deltaAvailableMinor = 0;
  }

  equals(other: Account): boolean {
    return (
      this.id === other.id &&
      this.accountNumber === other.accountNumber &&
      this.name === other.name &&
      this.ownerUserId === other.ownerUserId &&
      this.status === other.status &&
      this.currency === other.currency &&
      this.createdAt.getTime() === other.createdAt.getTime() &&
      this.isTest === other.isTest
    );
  }

  isFundingSource(): boolean {
    return this.id === FUNDING_SOURCE.ACCOUNT_ID;
  }
}
