import { z } from 'zod';
import { AccountNotFoundError, InvalidActivityCursorError } from '../errors';
import type { BankingRepository } from '../ports';
import type { HoldRepository, HoldActivityRecord } from '../HoldRepository';
import type { Logger, Metrics, PaginatedResult } from '../../domain/types';
import {
  METRIC_NAMES,
  METRIC_UNITS,
  OPERATION_NAMES,
  TimingUtils,
} from '@demo-bank-app/shared-observability';
import type { HoldFailedCode } from '../../domain/entities/Hold';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SAME_SECOND_THRESHOLD_MS = 1000;

type ActivityKind = 'HOLD_EVENT' | 'POSTED_TRANSACTION';

const KIND_PRIORITY: Record<ActivityKind, number> = {
  POSTED_TRANSACTION: 0,
  HOLD_EVENT: 1,
};

const compareTimes = (
  a: string,
  b: string,
  allowSameSecond: boolean
): number => {
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);

  if (Number.isNaN(timeA) || Number.isNaN(timeB)) {
    if (a > b) {
      return -1;
    }
    if (a < b) {
      return 1;
    }
    return 0;
  }

  if (timeA === timeB) {
    return 0;
  }

  const diff = timeA - timeB;
  if (allowSameSecond && Math.abs(diff) < SAME_SECOND_THRESHOLD_MS) {
    return 0;
  }

  return diff > 0 ? -1 : 1;
};

type HoldEventActivityItem =
  | {
      kind: 'HOLD_CREATED';
      activityId: string;
      holdId: string;
      amountMinor: number;
      description?: string;
      createdAt: string;
      counterpartyAccountNumber?: string;
      createdByUserId?: string;
      idempotencyKeyHash?: string;
      payNoteDocumentId?: string;
      cardId?: string;
      cardLast4?: string;
      merchantName?: string;
      merchantStatementDescriptor?: string;
      processorChargeId?: string;
    }
  | {
      kind: 'HOLD_RELEASED';
      activityId: string;
      holdId: string;
      amountMinor: number;
      description?: string;
      releasedAt: string;
      releaseReason?: string;
      payNoteDocumentId?: string;
      cardId?: string;
      cardLast4?: string;
      merchantName?: string;
      merchantStatementDescriptor?: string;
      processorChargeId?: string;
    }
  | {
      kind: 'HOLD_CAPTURED';
      activityId: string;
      holdId: string;
      amountMinor: number;
      description?: string;
      capturedAt: string;
      transactionId: string;
      counterpartyAccountNumber: string;
      payNoteDocumentId?: string;
      cardId?: string;
      cardLast4?: string;
      merchantName?: string;
      merchantStatementDescriptor?: string;
      processorChargeId?: string;
    }
  | {
      kind: 'HOLD_FAILED';
      activityId: string;
      holdId: string;
      amountMinor: number;
      description?: string;
      failedAt: string;
      failureCode: HoldFailedCode;
      failureMessage?: string;
      payNoteDocumentId?: string;
      cardId?: string;
      cardLast4?: string;
      merchantName?: string;
      merchantStatementDescriptor?: string;
      processorChargeId?: string;
    };

type PostedTransactionActivityItem = {
  kind: 'POSTED_TRANSACTION';
  activityId: string;
  transactionId: string;
  amountMinor: number;
  description?: string;
  postedAt: string;
  originHoldId?: string;
  side: 'DEBIT' | 'CREDIT';
  type: string;
  status: string;
  counterpartyAccountNumber?: string;
  payNoteDocumentId?: string;
  cardId?: string;
  cardLast4?: string;
  merchantName?: string;
  merchantStatementDescriptor?: string;
  processorChargeId?: string;
};

export type ActivityItem =
  | HoldEventActivityItem
  | PostedTransactionActivityItem;

export interface ListAccountActivityQuery {
  userId: string;
  accountNumber: string;
  limit?: number;
  cursor?: string;
}

export interface ListAccountActivityDependencies {
  bankingRepository: BankingRepository;
  holdRepository: HoldRepository;
  logger?: Logger;
  metrics?: Metrics;
}

interface ActivityCursorMarker {
  kind: ActivityKind;
  id: string;
  time: string;
}

interface BaseFeedItem {
  kind: ActivityKind;
  id: string;
  time: string;
}

interface HoldEventFeedItem extends BaseFeedItem {
  kind: 'HOLD_EVENT';
  holdId: string;
  eventId: string;
  item: HoldEventActivityItem;
}

interface TransactionFeedItem extends BaseFeedItem {
  kind: 'POSTED_TRANSACTION';
  transactionId: string;
  item: PostedTransactionActivityItem;
}

type ActivityFeedItem = HoldEventFeedItem | TransactionFeedItem;

const HoldEventActivityItemSchema: z.ZodType<HoldEventActivityItem> =
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('HOLD_CREATED'),
      activityId: z.string(),
      holdId: z.string(),
      amountMinor: z.number(),
      description: z.string().optional(),
      createdAt: z.string(),
      counterpartyAccountNumber: z.string().optional(),
      createdByUserId: z.string().optional(),
      idempotencyKeyHash: z.string().optional(),
      payNoteDocumentId: z.string().optional(),
      cardId: z.string().optional(),
      cardLast4: z.string().optional(),
      merchantName: z.string().optional(),
      merchantStatementDescriptor: z.string().optional(),
      processorChargeId: z.string().optional(),
    }),
    z.object({
      kind: z.literal('HOLD_RELEASED'),
      activityId: z.string(),
      holdId: z.string(),
      amountMinor: z.number(),
      description: z.string().optional(),
      releasedAt: z.string(),
      releaseReason: z.string().optional(),
      payNoteDocumentId: z.string().optional(),
      cardId: z.string().optional(),
      cardLast4: z.string().optional(),
      merchantName: z.string().optional(),
      merchantStatementDescriptor: z.string().optional(),
      processorChargeId: z.string().optional(),
    }),
    z.object({
      kind: z.literal('HOLD_CAPTURED'),
      activityId: z.string(),
      holdId: z.string(),
      amountMinor: z.number(),
      description: z.string().optional(),
      capturedAt: z.string(),
      transactionId: z.string(),
      counterpartyAccountNumber: z.string(),
      payNoteDocumentId: z.string().optional(),
      cardId: z.string().optional(),
      cardLast4: z.string().optional(),
      merchantName: z.string().optional(),
      merchantStatementDescriptor: z.string().optional(),
      processorChargeId: z.string().optional(),
    }),
    z.object({
      kind: z.literal('HOLD_FAILED'),
      activityId: z.string(),
      holdId: z.string(),
      amountMinor: z.number(),
      description: z.string().optional(),
      failedAt: z.string(),
      failureCode: z.enum([
        'INSUFFICIENT_FUNDS',
        'STATE_MISMATCH',
        'VALIDATION',
        'INTERNAL',
      ]),
      failureMessage: z.string().optional(),
      payNoteDocumentId: z.string().optional(),
      cardId: z.string().optional(),
      cardLast4: z.string().optional(),
      merchantName: z.string().optional(),
      merchantStatementDescriptor: z.string().optional(),
      processorChargeId: z.string().optional(),
    }),
  ]);

const PostedTransactionActivityItemSchema: z.ZodType<PostedTransactionActivityItem> =
  z.object({
    kind: z.literal('POSTED_TRANSACTION'),
    activityId: z.string(),
    transactionId: z.string(),
    amountMinor: z.number(),
    description: z.string().optional(),
    postedAt: z.string(),
    originHoldId: z.string().optional(),
    side: z.enum(['DEBIT', 'CREDIT']),
    type: z.string(),
    status: z.string(),
    counterpartyAccountNumber: z.string().optional(),
    payNoteDocumentId: z.string().optional(),
    cardId: z.string().optional(),
    cardLast4: z.string().optional(),
    merchantName: z.string().optional(),
    merchantStatementDescriptor: z.string().optional(),
    processorChargeId: z.string().optional(),
  });

const HoldEventCursorItemSchema = z.object({
  kind: z.literal('HOLD_EVENT'),
  id: z.string(),
  time: z.string(),
  holdId: z.string(),
  eventId: z.string(),
  item: HoldEventActivityItemSchema,
});

const TransactionCursorItemSchema = z.object({
  kind: z.literal('POSTED_TRANSACTION'),
  id: z.string(),
  time: z.string(),
  transactionId: z.string(),
  item: PostedTransactionActivityItemSchema,
});

const ActivityCursorItemSchema = z.discriminatedUnion('kind', [
  HoldEventCursorItemSchema,
  TransactionCursorItemSchema,
]);

const ActivityCursorSchema = z.object({
  holdEventsLek: z.string().optional(),
  txnsLek: z.string().optional(),
  holdEventsBuffer: z.array(ActivityCursorItemSchema).optional(),
  txnsBuffer: z.array(ActivityCursorItemSchema).optional(),
  last: z
    .object({
      kind: z.enum(['HOLD_EVENT', 'POSTED_TRANSACTION']),
      id: z.string(),
      time: z.string(),
    })
    .optional(),
});

interface SourceState {
  queue: ActivityFeedItem[];
  nextToken?: string;
  initialFetchDone: boolean;
  fetch: (options: { limit: number; nextToken?: string }) => Promise<{
    items: ActivityFeedItem[];
    nextToken?: string;
    hasMore: boolean;
  }>;
}

interface DecodedCursor {
  holdEventsLek?: string;
  txnsLek?: string;
  holdEventsBuffer?: ActivityFeedItem[];
  txnsBuffer?: ActivityFeedItem[];
  last?: ActivityCursorMarker;
}

const clampLimit = (limit?: number): number => {
  if (!limit || Number.isNaN(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
};

const buildHoldEventFeedItem = (
  record: HoldActivityRecord,
  holdPayNoteDocumentId?: string
): HoldEventFeedItem => {
  const cardMeta = {
    cardId: record.cardId,
    cardLast4: record.cardLast4,
    merchantName: record.merchantName,
    merchantStatementDescriptor: record.merchantStatementDescriptor,
    processorChargeId: record.processorChargeId,
  };

  const { event } = record;
  const resolvedPayNoteDocumentId =
    event.payNoteDocumentId ?? holdPayNoteDocumentId;
  const payNoteFields = resolvedPayNoteDocumentId
    ? { payNoteDocumentId: resolvedPayNoteDocumentId }
    : {};
  switch (event.type) {
    case 'CREATED':
      return {
        kind: 'HOLD_EVENT',
        id: `${record.holdId}#${record.eventId}`,
        holdId: record.holdId,
        eventId: record.eventId,
        time: event.at,
        item: {
          kind: 'HOLD_CREATED',
          activityId: `HOLD#${record.holdId}`,
          holdId: record.holdId,
          amountMinor: record.amountMinor,
          description: record.description,
          createdAt: event.at,
          counterpartyAccountNumber: record.counterpartyAccountNumber,
          createdByUserId: event.createdByUserId,
          idempotencyKeyHash: event.idempotencyKeyHash,
          ...payNoteFields,
          ...cardMeta,
        },
      };
    case 'RELEASED':
      return {
        kind: 'HOLD_EVENT',
        id: `${record.holdId}#${record.eventId}`,
        holdId: record.holdId,
        eventId: record.eventId,
        time: event.at,
        item: {
          kind: 'HOLD_RELEASED',
          activityId: `HOLD#${record.holdId}`,
          holdId: record.holdId,
          amountMinor: record.amountMinor,
          description: record.description,
          releasedAt: event.at,
          releaseReason: event.reason,
          ...payNoteFields,
          ...cardMeta,
        },
      };
    case 'CAPTURED': {
      const counterparty =
        event.counterpartyAccountNumber ??
        record.counterpartyAccountNumber ??
        '';
      return {
        kind: 'HOLD_EVENT',
        id: `${record.holdId}#${record.eventId}`,
        holdId: record.holdId,
        eventId: record.eventId,
        time: event.at,
        item: {
          kind: 'HOLD_CAPTURED',
          activityId: `HOLD#${record.holdId}`,
          holdId: record.holdId,
          amountMinor: record.amountMinor,
          description: record.description,
          capturedAt: event.at,
          transactionId: event.transactionId,
          counterpartyAccountNumber: counterparty,
          ...payNoteFields,
          ...cardMeta,
        },
      };
    }
    case 'FAILED':
      return {
        kind: 'HOLD_EVENT',
        id: `${record.holdId}#${record.eventId}`,
        holdId: record.holdId,
        eventId: record.eventId,
        time: event.at,
        item: {
          kind: 'HOLD_FAILED',
          activityId: `HOLD#${record.holdId}`,
          holdId: record.holdId,
          amountMinor: record.amountMinor,
          description: record.description,
          failedAt: event.at,
          failureCode: event.code,
          failureMessage: event.message,
          ...payNoteFields,
          ...cardMeta,
        },
      };
    default: {
      const exhaustive: never = event;
      const eventRecord = exhaustive as Record<string, unknown>;
      const eventType =
        typeof eventRecord.type === 'string' ? eventRecord.type : 'unknown';
      throw new Error(`Unhandled hold event type ${eventType}`);
    }
  }
};

const toTransactionFeedItem = (summary: {
  transactionId: string;
  postedAt: string;
  amountMinor: number;
  description?: string;
  originHoldId?: string;
  side: 'DEBIT' | 'CREDIT';
  type: string;
  status: string;
  counterpartyAccountNumber?: string;
  payNoteDocumentId?: string;
  cardId?: string;
  cardLast4?: string;
  merchantName?: string;
  merchantStatementDescriptor?: string;
  processorChargeId?: string;
}): TransactionFeedItem => ({
  kind: 'POSTED_TRANSACTION',
  id: summary.transactionId,
  transactionId: summary.transactionId,
  time: summary.postedAt,
  item: {
    kind: 'POSTED_TRANSACTION',
    activityId: `TXN#${summary.transactionId}`,
    transactionId: summary.transactionId,
    postedAt: summary.postedAt,
    amountMinor: summary.amountMinor,
    description: summary.description,
    originHoldId: summary.originHoldId,
    side: summary.side,
    type: summary.type,
    status: summary.status,
    counterpartyAccountNumber: summary.counterpartyAccountNumber,
    ...(summary.payNoteDocumentId
      ? { payNoteDocumentId: summary.payNoteDocumentId }
      : {}),
    cardId: summary.cardId,
    cardLast4: summary.cardLast4,
    merchantName: summary.merchantName,
    merchantStatementDescriptor: summary.merchantStatementDescriptor,
    processorChargeId: summary.processorChargeId,
  },
});

const serializeFeedItem = (item: ActivityFeedItem) => {
  if (item.kind === 'HOLD_EVENT') {
    return {
      kind: item.kind,
      id: item.id,
      time: item.time,
      holdId: item.holdId,
      eventId: item.eventId,
      item: item.item,
    };
  }

  return {
    kind: item.kind,
    id: item.id,
    time: item.time,
    transactionId: item.transactionId,
    item: item.item,
  };
};

const deserializeFeedItem = (
  data: z.infer<typeof ActivityCursorItemSchema>
): ActivityFeedItem => {
  if (data.kind === 'HOLD_EVENT') {
    return {
      kind: 'HOLD_EVENT',
      id: data.id,
      time: data.time,
      holdId: data.holdId,
      eventId: data.eventId,
      item: data.item,
    };
  }

  return {
    kind: 'POSTED_TRANSACTION',
    id: data.id,
    time: data.time,
    transactionId: data.transactionId,
    item: data.item,
  };
};

const decodeCursor = (token: string): DecodedCursor => {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parsed = ActivityCursorSchema.parse(JSON.parse(decoded));
    return {
      holdEventsLek: parsed.holdEventsLek,
      txnsLek: parsed.txnsLek,
      holdEventsBuffer: parsed.holdEventsBuffer?.map(deserializeFeedItem),
      txnsBuffer: parsed.txnsBuffer?.map(deserializeFeedItem),
      last: parsed.last,
    };
  } catch (error) {
    throw new InvalidActivityCursorError(
      error instanceof Error ? error.message : 'Failed to decode cursor'
    );
  }
};

const encodeCursor = (cursor: {
  holdEventsLek?: string;
  txnsLek?: string;
  holdEventsBuffer?: ActivityFeedItem[];
  txnsBuffer?: ActivityFeedItem[];
  last?: ActivityCursorMarker;
}): string => {
  const payload = {
    ...(cursor.holdEventsLek ? { holdEventsLek: cursor.holdEventsLek } : {}),
    ...(cursor.txnsLek ? { txnsLek: cursor.txnsLek } : {}),
    ...(cursor.holdEventsBuffer && cursor.holdEventsBuffer.length > 0
      ? {
          holdEventsBuffer: cursor.holdEventsBuffer.map(serializeFeedItem),
        }
      : {}),
    ...(cursor.txnsBuffer && cursor.txnsBuffer.length > 0
      ? { txnsBuffer: cursor.txnsBuffer.map(serializeFeedItem) }
      : {}),
    ...(cursor.last ? { last: cursor.last } : {}),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
};

const compareItems = (a: ActivityFeedItem, b: ActivityFeedItem): number => {
  const timeOrder = compareTimes(a.time, b.time, a.kind !== b.kind);
  if (timeOrder !== 0) {
    return timeOrder;
  }

  const priorityA = KIND_PRIORITY[a.kind];
  const priorityB = KIND_PRIORITY[b.kind];
  if (priorityA < priorityB) {
    return -1;
  }
  if (priorityA > priorityB) {
    return 1;
  }

  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }

  return 0;
};

const compareItemToMarker = (
  item: ActivityFeedItem,
  marker: ActivityCursorMarker
): number => {
  const timeOrder = compareTimes(
    item.time,
    marker.time,
    item.kind !== marker.kind
  );
  if (timeOrder !== 0) {
    return timeOrder;
  }

  const priorityA = KIND_PRIORITY[item.kind];
  const priorityB = KIND_PRIORITY[marker.kind];
  if (priorityA < priorityB) {
    return -1;
  }
  if (priorityA > priorityB) {
    return 1;
  }

  if (item.id < marker.id) {
    return -1;
  }
  if (item.id > marker.id) {
    return 1;
  }

  return 0;
};

const filterByMarker = (
  items: ActivityFeedItem[],
  marker: ActivityCursorMarker | undefined
) => {
  if (!marker) {
    return items;
  }
  return items.filter(item => compareItemToMarker(item, marker) === 1);
};

const toMarker = (item: ActivityFeedItem): ActivityCursorMarker => ({
  kind: item.kind,
  id: item.id,
  time: item.time,
});

const listHoldEventItems = async (
  holdRepository: HoldRepository,
  accountNumber: string,
  options: { limit: number; nextToken?: string }
) => {
  const result = await holdRepository.listHoldActivityByAccountNumber(
    accountNumber,
    {
      limit: options.limit,
      nextToken: options.nextToken,
    }
  );

  const holdIds = Array.from(new Set(result.items.map(item => item.holdId)));
  const holds = await Promise.all(
    holdIds.map(holdId => holdRepository.getHold(holdId))
  );
  const holdPayNoteMap = new Map(
    holdIds.map((holdId, index) => [holdId, holds[index]?.payNoteDocumentId])
  );

  return {
    items: result.items.map(record =>
      buildHoldEventFeedItem(record, holdPayNoteMap.get(record.holdId))
    ),
    nextToken: result.nextToken,
    hasMore: result.hasMore,
  };
};

const listTransactionItems = async (
  bankingRepository: BankingRepository,
  accountId: string,
  options: { limit: number; nextToken?: string }
) => {
  const result = await bankingRepository.getTransactionsByAccount(accountId, {
    limit: options.limit,
    nextToken: options.nextToken,
  });

  return {
    items: result.items.map(summary =>
      toTransactionFeedItem({
        transactionId: summary.transactionId,
        postedAt: summary.createdAt.toISOString(),
        amountMinor: summary.amount.toCents(),
        description: summary.description ?? undefined,
        originHoldId: summary.originHoldId,
        side: summary.side,
        type: summary.type,
        status: summary.status,
        counterpartyAccountNumber: summary.counterpartyAccountNumber,
        payNoteDocumentId: summary.payNoteDocumentId,
        cardId: summary.cardId,
        cardLast4: summary.cardLast4,
        merchantName: summary.merchantName,
        merchantStatementDescriptor: summary.merchantStatementDescriptor,
        processorChargeId: summary.processorChargeId,
      })
    ),
    nextToken: result.nextToken,
    hasMore: result.hasMore,
  };
};

const ensureNextItem = async (
  state: SourceState,
  marker: ActivityCursorMarker | undefined,
  limit: number
): Promise<ActivityFeedItem | undefined> => {
  while (state.queue.length === 0) {
    if (state.initialFetchDone && !state.nextToken) {
      return undefined;
    }

    const result = await state.fetch({
      limit,
      nextToken: state.initialFetchDone ? state.nextToken : undefined,
    });
    state.initialFetchDone = true;
    state.nextToken = result.nextToken;

    const filtered = filterByMarker(result.items, marker);
    if (filtered.length > 0) {
      state.queue.push(...filtered);
      break;
    }

    if (!result.hasMore || !result.nextToken) {
      return undefined;
    }
  }

  return state.queue[0];
};

export async function listAccountActivity(
  query: ListAccountActivityQuery,
  dependencies: ListAccountActivityDependencies
): Promise<PaginatedResult<ActivityItem>> {
  const { bankingRepository, holdRepository, logger, metrics } = dependencies;
  const { userId, accountNumber, cursor } = query;
  const limit = clampLimit(query.limit);

  const timing = TimingUtils.startTiming(OPERATION_NAMES.BANKING.ACTIVITY_LIST);

  logger?.debug('Activity listing started', {
    userId,
    accountNumber,
    limit,
    cursorProvided: Boolean(cursor),
    ...TimingUtils.createTimingMetadata(timing),
  });

  try {
    const accountId = await bankingRepository.getAccountIdByNumber(
      accountNumber
    );
    if (!accountId) {
      throw new AccountNotFoundError(accountNumber);
    }

    const account = await bankingRepository.getAccountById(accountId);
    if (!account || !account.isOwnedBy(userId)) {
      throw new AccountNotFoundError(accountNumber);
    }

    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    let lastMarker = decodedCursor?.last;

    const holdEventsState: SourceState = {
      queue: decodedCursor?.holdEventsBuffer
        ? [...decodedCursor.holdEventsBuffer]
        : [],
      nextToken: decodedCursor?.holdEventsLek,
      initialFetchDone: Boolean(decodedCursor),
      fetch: options =>
        listHoldEventItems(holdRepository, account.accountNumber, options),
    };

    const txnsState: SourceState = {
      queue: decodedCursor?.txnsBuffer ? [...decodedCursor.txnsBuffer] : [],
      nextToken: decodedCursor?.txnsLek,
      initialFetchDone: Boolean(decodedCursor),
      fetch: options =>
        listTransactionItems(bankingRepository, account.id, options),
    };

    const collected: ActivityFeedItem[] = [];

    while (collected.length < limit) {
      const [nextHoldEvent, nextTxn] = await Promise.all([
        ensureNextItem(holdEventsState, lastMarker, limit),
        ensureNextItem(txnsState, lastMarker, limit),
      ]);

      const candidates = [nextHoldEvent, nextTxn].filter(
        (candidate): candidate is ActivityFeedItem => Boolean(candidate)
      );

      if (candidates.length === 0) {
        break;
      }

      let selected: ActivityFeedItem;
      if (candidates.length === 1) {
        selected = candidates[0];
      } else {
        selected =
          compareItems(candidates[0], candidates[1]) <= 0
            ? candidates[0]
            : candidates[1];
      }

      if (lastMarker && compareItemToMarker(selected, lastMarker) <= 0) {
        if (selected.kind === 'HOLD_EVENT') {
          holdEventsState.queue.shift();
        } else {
          txnsState.queue.shift();
        }
        continue;
      }

      if (selected.kind === 'HOLD_EVENT') {
        holdEventsState.queue.shift();
      } else {
        txnsState.queue.shift();
      }

      collected.push(selected);
      lastMarker = toMarker(selected);
    }

    const hasMore =
      holdEventsState.queue.length > 0 ||
      txnsState.queue.length > 0 ||
      Boolean(holdEventsState.nextToken) ||
      Boolean(txnsState.nextToken);

    const nextCursor = hasMore
      ? encodeCursor({
          holdEventsLek: holdEventsState.nextToken,
          txnsLek: txnsState.nextToken,
          holdEventsBuffer: holdEventsState.queue,
          txnsBuffer: txnsState.queue,
          last: lastMarker,
        })
      : undefined;

    const items = collected.map(feed => feed.item);

    const completedTiming = TimingUtils.endTiming(timing);

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACTIVITY_LIST,
      METRIC_UNITS.COUNT,
      1
    );
    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACTIVITY_LIST_DURATION,
      METRIC_UNITS.MILLISECONDS,
      completedTiming.duration ?? 0
    );

    logger?.debug('Activity listing completed successfully', {
      userId,
      accountNumber,
      itemCount: items.length,
      hasMore,
      ...TimingUtils.createTimingMetadata(completedTiming),
    });

    return {
      items,
      nextToken: nextCursor,
      hasMore,
    };
  } catch (error) {
    const failedTiming = TimingUtils.endTiming(timing);

    logger?.error('Activity listing failed', {
      userId,
      accountNumber,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...TimingUtils.createTimingMetadata(failedTiming),
    });

    metrics?.addMetric(
      METRIC_NAMES.BANKING.ACTIVITY_LIST_ERROR,
      METRIC_UNITS.COUNT,
      1
    );

    throw error;
  }
}
