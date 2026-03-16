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

const sortActivityByTimestamp = (items: any[], timestampField: string): any[] =>
  [...items].sort((left, right) => {
    const leftTimestamp =
      typeof left?.[timestampField] === 'string' ? left[timestampField] : '';
    const rightTimestamp =
      typeof right?.[timestampField] === 'string' ? right[timestampField] : '';

    if (leftTimestamp !== rightTimestamp) {
      return leftTimestamp.localeCompare(rightTimestamp);
    }

    const leftActivityId =
      typeof left?.activityId === 'string' ? left.activityId : '';
    const rightActivityId =
      typeof right?.activityId === 'string' ? right.activityId : '';

    return leftActivityId.localeCompare(rightActivityId);
  });

function expectPayNoteCaptureSequence(input: {
  items: any[];
  payNoteDocumentId: string;
  expectedCaptureAmountsMinor: readonly number[];
}) {
  const payNoteMatches = (item: any): boolean =>
    item?.payNote?.payNoteDocumentId === input.payNoteDocumentId;

  const holdCaptures = sortActivityByTimestamp(
    findActivityMatches(
      input.items,
      item => item.kind === 'HOLD_CAPTURED' && payNoteMatches(item)
    ),
    'capturedAt'
  );
  const postedTransactions = sortActivityByTimestamp(
    findActivityMatches(
      input.items,
      item => item.kind === 'POSTED_TRANSACTION' && payNoteMatches(item)
    ),
    'postedAt'
  );

  expect(
    holdCaptures,
    'expected HOLD_CAPTURED items for the PayNote capture sequence'
  ).toHaveLength(input.expectedCaptureAmountsMinor.length);
  expect(
    postedTransactions,
    'expected POSTED_TRANSACTION items for the PayNote capture sequence'
  ).toHaveLength(input.expectedCaptureAmountsMinor.length);

  expect(holdCaptures.map(item => item.amountMinor)).toEqual([
    ...input.expectedCaptureAmountsMinor,
  ]);
  expect(postedTransactions.map(item => item.amountMinor)).toEqual([
    ...input.expectedCaptureAmountsMinor,
  ]);

  return {
    holdCaptures,
    postedTransactions,
  };
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

export async function waitForPayNoteCaptureSequence(input: {
  bank: BankTestDriver;
  jwtCookie: string;
  accountNumber: string;
  payNoteDocumentId: string;
  expectedCaptureAmountsMinor: readonly number[];
  timeoutMs?: number;
}) {
  let items: any[] = [];

  await waitForExpectWithLogging(
    async () => {
      items = await input.bank.getActivity(
        input.jwtCookie,
        input.accountNumber
      );

      expectPayNoteCaptureSequence({
        items,
        payNoteDocumentId: input.payNoteDocumentId,
        expectedCaptureAmountsMinor: input.expectedCaptureAmountsMinor,
      });
    },
    input.timeoutMs ?? 20_000,
    500,
    'paynote-capture-sequence'
  );

  return expectPayNoteCaptureSequence({
    items,
    payNoteDocumentId: input.payNoteDocumentId,
    expectedCaptureAmountsMinor: input.expectedCaptureAmountsMinor,
  });
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

export async function waitForNoDuplicatePayNoteCaptureSequenceAfterReplay(input: {
  bank: BankTestDriver;
  jwtCookie: string;
  accountNumber: string;
  payNoteDocumentId: string;
  expectedCaptureAmountsMinor: readonly number[];
  stablePeriodMs?: number;
}) {
  await waitForExpectWithLogging(
    async () => {
      const items = await input.bank.getActivity(
        input.jwtCookie,
        input.accountNumber
      );

      expectPayNoteCaptureSequence({
        items,
        payNoteDocumentId: input.payNoteDocumentId,
        expectedCaptureAmountsMinor: input.expectedCaptureAmountsMinor,
      });
    },
    input.stablePeriodMs ?? 2_000,
    500,
    'no-duplicate-paynote-capture-sequence'
  );
}
