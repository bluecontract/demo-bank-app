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

export async function waitForSinglePostedCapture(input: {
  bank: BankTestDriver;
  jwtCookie: string;
  accountNumber: string;
  processorChargeId: string;
  timeoutMs?: number;
}) {
  let items: any[] = [];

  await waitForExpectWithLogging(
    async () => {
      items = await input.bank.getActivity(
        input.jwtCookie,
        input.accountNumber
      );

      expectExactlyOneActivityMatch(
        items,
        item =>
          item.processorChargeId === input.processorChargeId &&
          item.kind === 'HOLD_CAPTURED',
        'single hold capture'
      );

      expectExactlyOneActivityMatch(
        items,
        item =>
          item.processorChargeId === input.processorChargeId &&
          item.kind === 'POSTED_TRANSACTION',
        'single posted transaction'
      );
    },
    input.timeoutMs ?? 20_000,
    500,
    'single-posted-capture'
  );

  return {
    holdCapture: expectExactlyOneActivityMatch(
      items,
      item =>
        item.processorChargeId === input.processorChargeId &&
        item.kind === 'HOLD_CAPTURED',
      'single hold capture'
    ),
    postedTransaction: expectExactlyOneActivityMatch(
      items,
      item =>
        item.processorChargeId === input.processorChargeId &&
        item.kind === 'POSTED_TRANSACTION',
      'single posted transaction'
    ),
  };
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

      expect(
        findActivityMatches(
          items,
          item =>
            item.processorChargeId === input.processorChargeId &&
            item.kind === 'HOLD_CAPTURED'
        ),
        'expected exactly one hold capture after replay'
      ).toHaveLength(1);

      expect(
        findActivityMatches(
          items,
          item =>
            item.processorChargeId === input.processorChargeId &&
            item.kind === 'POSTED_TRANSACTION'
        ),
        'expected exactly one posted transaction after replay'
      ).toHaveLength(1);
    },
    stablePeriodMs,
    500,
    'no-duplicate-activity'
  );
}
