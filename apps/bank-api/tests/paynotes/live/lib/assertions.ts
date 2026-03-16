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
  processorChargeId?: string;
  holdId?: string;
  transactionId?: string;
  timeoutMs?: number;
}) {
  let items: any[] = [];
  const matchesHoldCapture = (item: any): boolean =>
    item.kind === 'HOLD_CAPTURED' &&
    Boolean(
      (input.processorChargeId &&
        item.processorChargeId === input.processorChargeId) ||
        (input.holdId && item.holdId === input.holdId)
    );
  const matchesPostedTransaction = (item: any): boolean =>
    item.kind === 'POSTED_TRANSACTION' &&
    Boolean(
      (input.processorChargeId &&
        item.processorChargeId === input.processorChargeId) ||
        (input.transactionId && item.transactionId === input.transactionId)
    );

  await waitForExpectWithLogging(
    async () => {
      items = await input.bank.getActivity(
        input.jwtCookie,
        input.accountNumber
      );

      expectExactlyOneActivityMatch(
        items,
        matchesHoldCapture,
        'single hold capture'
      );

      expectExactlyOneActivityMatch(
        items,
        matchesPostedTransaction,
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
      matchesHoldCapture,
      'single hold capture'
    ),
    postedTransaction: expectExactlyOneActivityMatch(
      items,
      matchesPostedTransaction,
      'single posted transaction'
    ),
  };
}

export async function waitForNoDuplicateActivityAfterReplay(input: {
  bank: BankTestDriver;
  jwtCookie: string;
  accountNumber: string;
  processorChargeId?: string;
  holdId?: string;
  transactionId?: string;
  stablePeriodMs?: number;
}) {
  const stablePeriodMs = input.stablePeriodMs ?? 2_000;
  const matchesHoldCapture = (item: any): boolean =>
    item.kind === 'HOLD_CAPTURED' &&
    Boolean(
      (input.processorChargeId &&
        item.processorChargeId === input.processorChargeId) ||
        (input.holdId && item.holdId === input.holdId)
    );
  const matchesPostedTransaction = (item: any): boolean =>
    item.kind === 'POSTED_TRANSACTION' &&
    Boolean(
      (input.processorChargeId &&
        item.processorChargeId === input.processorChargeId) ||
        (input.transactionId && item.transactionId === input.transactionId)
    );

  await waitForExpectWithLogging(
    async () => {
      const items = await input.bank.getActivity(
        input.jwtCookie,
        input.accountNumber
      );

      expect(
        findActivityMatches(items, matchesHoldCapture),
        'expected exactly one hold capture after replay'
      ).toHaveLength(1);

      expect(
        findActivityMatches(items, matchesPostedTransaction),
        'expected exactly one posted transaction after replay'
      ).toHaveLength(1);
    },
    stablePeriodMs,
    500,
    'no-duplicate-activity'
  );
}
