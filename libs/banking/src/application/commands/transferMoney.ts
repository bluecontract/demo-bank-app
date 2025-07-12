import { Transaction } from '../../domain/entities/Transaction';
import { Posting, Side } from '../../domain/valueObjects/Posting';
import { Money } from '../../domain/valueObjects/Money';
import { BankingRepository, TransactionContext } from '../ports';
import { ForbiddenError, AccountNotFoundError } from '../errors';

export interface TransferMoneyCommand {
  srcAccountId: string;
  dstAccountNumber: string;
  amountMinor: Money;
  description: string;
  ctx: TransactionContext;
}

export interface TransferMoneyDependencies {
  repository: BankingRepository;
}

export async function transferMoney(
  cmd: TransferMoneyCommand,
  deps: TransferMoneyDependencies
): Promise<string> {
  const { repository } = deps;
  const { srcAccountId, dstAccountNumber, amountMinor, description, ctx } = cmd;

  const dstAccountId = await repository.getAccountIdByNumber(dstAccountNumber);
  if (!dstAccountId) {
    throw new AccountNotFoundError(
      dstAccountNumber,
      new Error(`Destination account ${dstAccountNumber} not found by number`)
    );
  }

  const [src, dst] = await Promise.all([
    repository.getAccountById(srcAccountId),
    repository.getAccountById(dstAccountId),
  ]);

  if (!src) {
    throw new AccountNotFoundError(srcAccountId);
  }

  if (!dst) {
    throw new AccountNotFoundError(dstAccountId);
  }

  if (!src.isOwnedBy(ctx.userId)) {
    throw new ForbiddenError('Access denied to source account');
  }

  src.ensureSufficientFunds(amountMinor);
  dst.ensureActive();

  const debit = new Posting({
    accountId: src.id,
    amount: amountMinor,
    side: 'DEBIT' as Side,
    accountNumber: src.accountNumber,
    counterpartyAccountNumber: dst.accountNumber,
  });

  const credit = new Posting({
    accountId: dst.id,
    amount: amountMinor,
    side: 'CREDIT' as Side,
    accountNumber: dst.accountNumber,
    counterpartyAccountNumber: src.accountNumber,
  });

  src.applyPosting(debit);
  dst.applyPosting(credit);

  const txn = Transaction.create([debit, credit], {
    idempotencyKey: ctx.idempotencyKey,
    description,
  });

  return repository.saveTransactionWithAccounts(txn, [src, dst], ctx);
}
