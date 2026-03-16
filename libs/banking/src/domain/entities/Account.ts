import {
  AccountInactiveError,
  InsufficientFundsError,
  InvalidAccountError,
} from '../errors';
import { Posting } from '../valueObjects/Posting';
import { Money } from '../valueObjects/Money';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type AccountType = 'DEPOSIT' | 'CREDIT_LINE';
export type Currency = 'USD';
export const FUNDING_SOURCE = {
  ACCOUNT_ID: 'FUNDING_SOURCE',
  ACCOUNT_NUMBER: '0000000000',
};

export const CARD_SETTLEMENT = {
  ACCOUNT_ID: 'CARD_SETTLEMENT',
  ACCOUNT_NUMBER: '9999999999',
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
  accountType?: AccountType;
  creditLimitMinor?: Money;
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
  readonly accountType: AccountType;
  public creditLimitMinor?: Money;
  public ledgerBalanceMinor: Money;
  public availableBalanceMinor: Money;
  public balanceVersion: number;

  private _deltaLedgerMinor = 0;
  private _deltaAvailableMinor = 0;

  constructor(props: AccountProps) {
    if (!props.id || props.id.trim() === '') {
      throw new InvalidAccountError('id', 'Account ID cannot be empty');
    }

    if (!props.accountNumber || props.accountNumber.trim() === '') {
      throw new InvalidAccountError(
        'accountNumber',
        'Account number cannot be empty'
      );
    }

    if (!props.name || props.name.trim() === '') {
      throw new InvalidAccountError('name', 'Account name cannot be empty');
    }

    if (props.name.length > 100) {
      throw new InvalidAccountError(
        'name',
        'Account name must be 100 characters or less'
      );
    }

    if (!props.ownerUserId || props.ownerUserId.trim() === '') {
      throw new InvalidAccountError(
        'ownerUserId',
        'Owner user ID cannot be empty'
      );
    }

    // Validate account number is exactly 10 digits
    if (!/^\d{10}$/.test(props.accountNumber)) {
      throw new InvalidAccountError(
        'accountNumber',
        'Account number must be exactly 10 digits'
      );
    }

    // Validate required balance and version fields
    if (!props.ledgerBalanceMinor) {
      throw new InvalidAccountError(
        'ledgerBalanceMinor',
        'Ledger balance must be provided'
      );
    }

    if (!props.availableBalanceMinor) {
      throw new InvalidAccountError(
        'availableBalanceMinor',
        'Available balance must be provided'
      );
    }

    if (typeof props.balanceVersion !== 'number' || props.balanceVersion < 0) {
      throw new InvalidAccountError(
        'balanceVersion',
        'Balance version must be a non-negative number'
      );
    }

    const accountType = props.accountType ?? 'DEPOSIT';

    if (accountType === 'CREDIT_LINE') {
      if (!props.creditLimitMinor) {
        throw new InvalidAccountError(
          'creditLimitMinor',
          'Credit limit must be provided for credit line accounts'
        );
      }

      if (props.availableBalanceMinor.isGreaterThan(props.ledgerBalanceMinor)) {
        throw new InvalidAccountError(
          'availableBalanceMinor',
          'Available balance cannot exceed ledger balance'
        );
      }
    }

    this.id = props.id;
    this.accountNumber = props.accountNumber;
    this.name = props.name;
    this.ownerUserId = props.ownerUserId;
    this.status = props.status;
    this.currency = props.currency;
    this.createdAt = props.createdAt;
    this.isTest = props.isTest ?? false;
    this.accountType = accountType;
    this.creditLimitMinor = props.creditLimitMinor;
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

  ensureSufficientFunds(amountMinor: Money): void {
    if (this.isFundingSource()) {
      return;
    }

    if (this.availableBalanceMinor.isLessThan(amountMinor)) {
      throw new InsufficientFundsError(
        amountMinor.toCents(),
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

  updateCreditLimit(newLimit: Money): void {
    if (this.accountType !== 'CREDIT_LINE') {
      throw new InvalidAccountError(
        'accountType',
        'Credit limit can only be updated for credit line accounts'
      );
    }

    if (!this.creditLimitMinor) {
      throw new InvalidAccountError(
        'creditLimitMinor',
        'Credit limit must be set for credit line accounts'
      );
    }

    const oldLimitMinor = this.creditLimitMinor.toCents();
    const newLimitMinor = newLimit.toCents();
    const usedPosted = Math.max(
      0,
      oldLimitMinor - this.ledgerBalanceMinor.toCents()
    );
    const usedReserved = Math.max(
      0,
      oldLimitMinor - this.availableBalanceMinor.toCents()
    );

    if (newLimitMinor < usedPosted || newLimitMinor < usedReserved) {
      throw new InvalidAccountError(
        'creditLimitMinor',
        'Credit limit cannot be lower than used credit'
      );
    }

    const delta = newLimitMinor - oldLimitMinor;
    if (delta > 0) {
      this.ledgerBalanceMinor = this.ledgerBalanceMinor.add(new Money(delta));
      this.availableBalanceMinor = this.availableBalanceMinor.add(
        new Money(delta)
      );
    } else if (delta < 0) {
      this.ledgerBalanceMinor = this.ledgerBalanceMinor.subtract(
        new Money(-delta)
      );
      this.availableBalanceMinor = this.availableBalanceMinor.subtract(
        new Money(-delta)
      );
    }

    this.creditLimitMinor = newLimit;
  }

  equals(other: Account): boolean {
    const creditLimitMatches =
      this.creditLimitMinor && other.creditLimitMinor
        ? this.creditLimitMinor.equals(other.creditLimitMinor)
        : this.creditLimitMinor === other.creditLimitMinor;

    return (
      this.id === other.id &&
      this.accountNumber === other.accountNumber &&
      this.name === other.name &&
      this.ownerUserId === other.ownerUserId &&
      this.status === other.status &&
      this.currency === other.currency &&
      this.createdAt.getTime() === other.createdAt.getTime() &&
      this.isTest === other.isTest &&
      this.accountType === other.accountType &&
      creditLimitMatches
    );
  }

  isFundingSource(): boolean {
    return this.id === FUNDING_SOURCE.ACCOUNT_ID;
  }
}
