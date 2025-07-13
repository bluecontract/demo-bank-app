import { InvalidMoneyAmountError } from '../errors';

export class Money {
  private readonly amountMinor: number;

  constructor(amountMinor: number) {
    if (!Number.isInteger(amountMinor) || amountMinor < 0) {
      throw new InvalidMoneyAmountError(amountMinor);
    }
    this.amountMinor = amountMinor;
  }

  static readonly ZERO = new Money(0);

  toCents(): number {
    return this.amountMinor;
  }

  format(): string {
    return `$${(this.amountMinor / 100).toFixed(2)}`;
  }

  add(other: Money): Money {
    return new Money(this.amountMinor + other.amountMinor);
  }

  subtract(other: Money): Money {
    return new Money(this.amountMinor - other.amountMinor);
  }

  isGreaterThan(other: Money): boolean {
    return this.amountMinor > other.amountMinor;
  }

  isLessThan(other: Money): boolean {
    return this.amountMinor < other.amountMinor;
  }

  equals(other: Money): boolean {
    return this.amountMinor === other.amountMinor;
  }

  isPositive(): boolean {
    return this.amountMinor > 0;
  }

  isZero(): boolean {
    return this.amountMinor === 0;
  }
}
