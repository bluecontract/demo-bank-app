import { Money } from './Money';
import { InvalidBalanceSnapshotError } from '../errors';

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
      throw new InvalidBalanceSnapshotError(
        'accountId',
        'Account ID cannot be empty'
      );
    }

    if (props.version < 0) {
      throw new InvalidBalanceSnapshotError(
        'version',
        'Version must be non-negative'
      );
    }

    if (props.availableBalance.isGreaterThan(props.ledgerBalance)) {
      throw new InvalidBalanceSnapshotError(
        'availableBalance',
        'Available balance cannot exceed ledger balance'
      );
    }

    this.accountId = props.accountId;
    this.ledgerBalance = props.ledgerBalance;
    this.availableBalance = props.availableBalance;
    this.version = props.version;
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
