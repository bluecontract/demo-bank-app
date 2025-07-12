import { Account } from '../../domain/entities/Account';
import { Money } from '../../domain/valueObjects/Money';
import { BankingRepository, AccountNumberGenerator } from '../ports';
import { AccountResult } from '../dtos';
import { randomUUID } from 'crypto';

export interface CreateAccountCommand {
  ownerId: string;
  name: string;
  isTest?: boolean;
}

export interface CreateAccountDependencies {
  repository: BankingRepository;
  accountNumberGenerator: AccountNumberGenerator;
}

function toAccountResult(account: Account): AccountResult {
  return {
    id: account.id,
    accountNumber: account.accountNumber,
    name: account.name,
    ownerUserId: account.ownerUserId,
    status: account.status,
    currency: account.currency,
    createdAt: account.createdAt,
    ledgerBalanceMinor: account.ledgerBalanceMinor,
    availableBalanceMinor: account.availableBalanceMinor,
    balanceVersion: account.balanceVersion,
  };
}

export async function createAccount(
  command: CreateAccountCommand,
  dependencies: CreateAccountDependencies
): Promise<AccountResult> {
  const { repository, accountNumberGenerator } = dependencies;

  const accountId = randomUUID();
  const accountNumber = accountNumberGenerator.generate();

  const account = new Account({
    id: accountId,
    accountNumber,
    name: command.name,
    ownerUserId: command.ownerId,
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date(),
    isTest: command.isTest ?? false,
    ledgerBalanceMinor: new Money(0),
    availableBalanceMinor: new Money(0),
    balanceVersion: 0,
  });

  const savedAccount = await repository.saveAccount(account);
  return toAccountResult(savedAccount);
}
