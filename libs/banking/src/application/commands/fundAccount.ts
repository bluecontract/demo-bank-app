import { FUNDING_SOURCE } from '../../domain/entities/Account';
import { TransactionContext } from '../ports';
import { transferMoney, TransferMoneyDependencies } from './transferMoney';
import { AccountNotFoundError } from '../errors';
import { Money } from '../../domain/valueObjects/Money';

export interface FundAccountCommand {
  accountId: string;
  amountMinor: Money;
  ctx: TransactionContext;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface
export interface FundAccountDependencies extends TransferMoneyDependencies {}

export async function fundAccount(
  cmd: FundAccountCommand,
  deps: FundAccountDependencies
): Promise<string> {
  const { accountId, amountMinor, ctx } = cmd;
  const { repository } = deps;

  // Load the account to get the account number for the description
  const account = await repository.getAccountById(accountId);

  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  return transferMoney(
    {
      srcAccountId: FUNDING_SOURCE.ACCOUNT_ID,
      dstAccountNumber: account.accountNumber,
      amountMinor,
      description: `Funding for account ${account.accountNumber}`,
      ctx,
    },
    deps
  );
}
