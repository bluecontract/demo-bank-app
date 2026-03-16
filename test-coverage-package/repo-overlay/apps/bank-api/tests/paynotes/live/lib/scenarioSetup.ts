import { FAST_AMOUNTS, assertSafeTestAmount, sumMinor } from './amounts';
import type { BankTestDriver } from './BankTestDriver';

export async function createFundedCustomerAccount(
  bank: BankTestDriver,
  input: {
    prefix?: string;
    accountName?: string;
    fundingAmountMinor?: number;
  } = {}
) {
  return bank.createFundedAccount({
    prefix: input.prefix,
    accountName: input.accountName,
    fundingAmountMinor:
      input.fundingAmountMinor ?? FAST_AMOUNTS.fundingBufferMinor,
  });
}

export async function createFundedCustomerWithCard(
  bank: BankTestDriver,
  input: {
    prefix?: string;
    accountName?: string;
    fundingAmountMinor?: number;
  } = {}
) {
  return bank.createFundedAccountWithCard({
    prefix: input.prefix,
    accountName: input.accountName,
    fundingAmountMinor:
      input.fundingAmountMinor ?? FAST_AMOUNTS.fundingBufferMinor,
  });
}

export async function createFundedTransferPair(
  bank: BankTestDriver,
  amountMinor = FAST_AMOUNTS.transferMinor
) {
  assertSafeTestAmount(amountMinor);
  const totalFunding = amountMinor + FAST_AMOUNTS.fundingBufferMinor;
  const payer = await createFundedCustomerAccount(bank, {
    prefix: 'paynote-transfer-payer',
    accountName: 'PayNote transfer payer',
    fundingAmountMinor: totalFunding,
  });
  const payee = await createFundedCustomerAccount(bank, {
    prefix: 'paynote-transfer-payee',
    accountName: 'PayNote transfer payee',
    fundingAmountMinor: FAST_AMOUNTS.fundingBufferMinor,
  });
  return { payer, payee, amountMinor };
}

export function requiredFundingForMilestones() {
  return (
    sumMinor(FAST_AMOUNTS.scaledMilestoneCapturesMinor) +
    FAST_AMOUNTS.fundingBufferMinor
  );
}
