import { expect } from 'vitest';
import type { BankTestDriver } from './BankTestDriver';
import { waitForExpectWithLogging } from './wait';

export function findActivityMatches(
  items: any[],
  predicate: (item: any) => boolean
) {
  return items.filter(predicate);
}

export function expectExactlyOneActivityMatch(
  items: any[],
  predicate: (item: any) => boolean,
  label: string
) {
  const matches = findActivityMatches(items, predicate);
  expect(matches, `${label} expected exactly one activity match`).toHaveLength(
    1
  );
  return matches[0];
}

export function expectNoAdditionalActivityMatches(
  items: any[],
  predicate: (item: any) => boolean,
  expectedCount: number,
  label: string
) {
  const matches = findActivityMatches(items, predicate);
  expect(matches, `${label} expected ${expectedCount} matches`).toHaveLength(
    expectedCount
  );
}

export async function waitForSinglePostedCapture(input: {
  bank: BankTestDriver;
  jwtCookie: string;
  accountNumber: string;
  processorChargeId: string;
  timeoutMs?: number;
}) {
  const items = await input.bank.waitForActivity({
    jwtCookie: input.jwtCookie,
    accountNumber: input.accountNumber,
    timeoutMs: input.timeoutMs,
    predicate: activityItems =>
      findActivityMatches(
        activityItems,
        item =>
          item.processorChargeId === input.processorChargeId &&
          (item.kind === 'HOLD_CAPTURED' || item.kind === 'POSTED_TRANSACTION')
      ).length === 1,
  });

  return expectExactlyOneActivityMatch(
    items,
    item =>
      item.processorChargeId === input.processorChargeId &&
      (item.kind === 'HOLD_CAPTURED' || item.kind === 'POSTED_TRANSACTION'),
    'single posted capture'
  );
}

export async function waitForNoDuplicateActivityAfterReplay(input: {
  bank: BankTestDriver;
  jwtCookie: string;
  accountNumber: string;
  processorChargeId: string;
  stablePeriodMs?: number;
}) {
  const stablePeriodMs = input.stablePeriodMs ?? 2_000;
  await waitForExpectWithLogging(
    async () => {
      const items = await input.bank.getActivity(
        input.jwtCookie,
        input.accountNumber
      );
      expectNoAdditionalActivityMatches(
        items,
        item =>
          item.processorChargeId === input.processorChargeId &&
          (item.kind === 'HOLD_CAPTURED' || item.kind === 'POSTED_TRANSACTION'),
        1,
        'no duplicate capture after replay'
      );
    },
    stablePeriodMs,
    500,
    'no-duplicate-activity'
  );
}

export async function waitForMyOsOperation(waitFn: () => Promise<unknown>) {
  return waitFn();
}
