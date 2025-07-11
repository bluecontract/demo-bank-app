import { Money } from './Money';

export interface BalanceSnapshotProps {
  accountId: string;
  ledgerBalance: Money;
  availableBalance: Money;
  version: number;
}

export class BalanceSnapshot {
  readonly accountId: string;
  readonly ledgerBalance: Money;
  readonly availableBalance: Money;
  readonly version: number;

  constructor(props: BalanceSnapshotProps) {
    if (!props.accountId || props.accountId.trim() === '') {
      throw new Error('Account ID cannot be empty');
    }

    if (props.version < 0) {
      throw new Error('Version must be non-negative');
    }

    if (props.availableBalance.isGreaterThan(props.ledgerBalance)) {
      throw new Error('Available balance cannot exceed ledger balance');
    }

    this.accountId = props.accountId;
    this.ledgerBalance = props.ledgerBalance;
    this.availableBalance = props.availableBalance;
    this.version = props.version;
  }

  addToBalance(amount: Money): BalanceSnapshot {
    return new BalanceSnapshot({
      accountId: this.accountId,
      ledgerBalance: this.ledgerBalance.add(amount),
      availableBalance: this.availableBalance.add(amount),
      version: this.version + 1,
    });
  }

  subtractFromBalance(amount: Money): BalanceSnapshot {
    return new BalanceSnapshot({
      accountId: this.accountId,
      ledgerBalance: this.ledgerBalance.subtract(amount),
      availableBalance: this.availableBalance.subtract(amount),
      version: this.version + 1,
    });
  }

  equals(other: BalanceSnapshot): boolean {
    return (
      this.accountId === other.accountId &&
      this.ledgerBalance.equals(other.ledgerBalance) &&
      this.availableBalance.equals(other.availableBalance) &&
      this.version === other.version
    );
  }
}
