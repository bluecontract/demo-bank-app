import { z } from 'zod';
import { AccountNotFoundError, InvalidActivityCursorError } from '../errors';
import type { BankingRepository } from '../ports';
import type { HoldRepository } from '../HoldRepository';
import type { Logger, Metrics, PaginatedResult } from '../../domain/types';
import {
  METRIC_NAMES,
  METRIC_UNITS,
  OPERATION_NAMES,
  TimingUtils,
} from '@demo-bank-app/shared-observability';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type ActivityKind = 'PENDING_HOLD' | 'POSTED_TRANSACTION';

const KIND_PRIORITY: Record<ActivityKind, number> = {
  POSTED_TRANSACTION: 0,
  PENDING_HOLD: 1,
};

export type ActivityItem =
  | {
      kind: 'PENDING_HOLD';
      holdId: string;
      amountMinor: number;
      description?: string;
      createdAt: string;
    }
  | {
      kind: 'POSTED_TRANSACTION';
      transactionId: string;
      amountMinor: number;
      description?: string;
      postedAt: string;
      originHoldId?: string;
    };

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
  amountMinor: number;
  description?: string;
}

interface HoldFeedItem extends BaseFeedItem {
  kind: 'PENDING_HOLD';
  holdId: string;
  createdAt: string;
}

interface TransactionFeedItem extends BaseFeedItem {
  kind: 'POSTED_TRANSACTION';
  transactionId: string;
  postedAt: string;
  originHoldId?: string;
}

type ActivityFeedItem = HoldFeedItem | TransactionFeedItem;

const ActivityCursorItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('PENDING_HOLD'),
    holdId: z.string(),
    createdAt: z.string(),
    amountMinor: z.number(),
    description: z.string().optional(),
    time: z.string(),
  }),
  z.object({
    kind: z.literal('POSTED_TRANSACTION'),
    transactionId: z.string(),
    postedAt: z.string(),
    amountMinor: z.number(),
    description: z.string().optional(),
    originHoldId: z.string().optional(),
    time: z.string(),
  }),
]);

const ActivityCursorSchema = z.object({
  holdsLek: z.string().optional(),
  txnsLek: z.string().optional(),
  holdsBuffer: z.array(ActivityCursorItemSchema).optional(),
  txnsBuffer: z.array(ActivityCursorItemSchema).optional(),
  last: z
    .object({
      kind: z.enum(['PENDING_HOLD', 'POSTED_TRANSACTION']),
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
  holdsLek?: string;
  txnsLek?: string;
  holdsBuffer?: ActivityFeedItem[];
  txnsBuffer?: ActivityFeedItem[];
  last?: ActivityCursorMarker;
}

const clampLimit = (limit?: number): number => {
  if (!limit || Number.isNaN(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT);
};

const toHoldFeedItem = (hold: {
  holdId: string;
  createdAt: string;
  amountMinor: number;
  description?: string;
}): HoldFeedItem => ({
  kind: 'PENDING_HOLD',
  id: hold.holdId,
  holdId: hold.holdId,
  createdAt: hold.createdAt,
  time: hold.createdAt,
  amountMinor: hold.amountMinor,
  description: hold.description,
});

const toTransactionFeedItem = (summary: {
  transactionId: string;
  postedAt: string;
  amountMinor: number;
  description?: string;
  originHoldId?: string;
}): TransactionFeedItem => ({
  kind: 'POSTED_TRANSACTION',
  id: summary.transactionId,
  transactionId: summary.transactionId,
  postedAt: summary.postedAt,
  time: summary.postedAt,
  amountMinor: summary.amountMinor,
  description: summary.description,
  originHoldId: summary.originHoldId,
});

const serializeFeedItem = (item: ActivityFeedItem) => {
  if (item.kind === 'PENDING_HOLD') {
    return {
      kind: item.kind,
      holdId: item.holdId,
      createdAt: item.createdAt,
      amountMinor: item.amountMinor,
      description: item.description,
      time: item.time,
    };
  }

  return {
    kind: item.kind,
    transactionId: item.transactionId,
    postedAt: item.postedAt,
    amountMinor: item.amountMinor,
    description: item.description,
    originHoldId: item.originHoldId,
    time: item.time,
  };
};

const deserializeFeedItem = (
  item: z.infer<typeof ActivityCursorItemSchema>
): ActivityFeedItem => {
  if (item.kind === 'PENDING_HOLD') {
    return {
      kind: 'PENDING_HOLD',
      id: item.holdId,
      holdId: item.holdId,
      createdAt: item.createdAt,
      time: item.time,
      amountMinor: item.amountMinor,
      description: item.description,
    };
  }

  return {
    kind: 'POSTED_TRANSACTION',
    id: item.transactionId,
    transactionId: item.transactionId,
    postedAt: item.postedAt,
    time: item.time,
    amountMinor: item.amountMinor,
    description: item.description,
    originHoldId: item.originHoldId,
  };
};

const decodeCursor = (cursor: string): DecodedCursor => {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = ActivityCursorSchema.parse(JSON.parse(decoded));
    return {
      holdsLek: parsed.holdsLek,
      txnsLek: parsed.txnsLek,
      holdsBuffer: parsed.holdsBuffer?.map(deserializeFeedItem),
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
  holdsLek?: string;
  txnsLek?: string;
  holdsBuffer?: ActivityFeedItem[];
  txnsBuffer?: ActivityFeedItem[];
  last?: ActivityCursorMarker;
}): string => {
  const payload = {
    ...(cursor.holdsLek ? { holdsLek: cursor.holdsLek } : {}),
    ...(cursor.txnsLek ? { txnsLek: cursor.txnsLek } : {}),
    ...(cursor.holdsBuffer && cursor.holdsBuffer.length > 0
      ? { holdsBuffer: cursor.holdsBuffer.map(serializeFeedItem) }
      : {}),
    ...(cursor.txnsBuffer && cursor.txnsBuffer.length > 0
      ? { txnsBuffer: cursor.txnsBuffer.map(serializeFeedItem) }
      : {}),
    ...(cursor.last ? { last: cursor.last } : {}),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
};

const compareItems = (a: ActivityFeedItem, b: ActivityFeedItem): number => {
  if (a.time > b.time) {
    return -1;
  }
  if (a.time < b.time) {
    return 1;
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
  if (item.time > marker.time) {
    return -1;
  }
  if (item.time < marker.time) {
    return 1;
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

const toActivityItem = (item: ActivityFeedItem): ActivityItem => {
  if (item.kind === 'PENDING_HOLD') {
    return {
      kind: item.kind,
      holdId: item.holdId,
      createdAt: item.createdAt,
      amountMinor: item.amountMinor,
      description: item.description,
    };
  }

  return {
    kind: item.kind,
    transactionId: item.transactionId,
    postedAt: item.postedAt,
    amountMinor: item.amountMinor,
    description: item.description,
    originHoldId: item.originHoldId,
  };
};

const listPendingHoldItems = async (
  holdRepository: HoldRepository,
  accountNumber: string,
  options: { limit: number; nextToken?: string }
) => {
  const result = await holdRepository.listPendingHoldsByAccountNumber(
    accountNumber,
    {
      limit: options.limit,
      nextToken: options.nextToken,
    }
  );

  return {
    items: result.items.map(hold =>
      toHoldFeedItem({
        holdId: hold.holdId,
        createdAt: hold.createdAt,
        amountMinor: hold.amountMinor,
        description: hold.description,
      })
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

    const holdsState: SourceState = {
      queue: decodedCursor?.holdsBuffer ? [...decodedCursor.holdsBuffer] : [],
      nextToken: decodedCursor?.holdsLek,
      initialFetchDone: Boolean(decodedCursor),
      fetch: options =>
        listPendingHoldItems(holdRepository, account.accountNumber, options),
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
      const [nextHold, nextTxn] = await Promise.all([
        ensureNextItem(holdsState, lastMarker, limit),
        ensureNextItem(txnsState, lastMarker, limit),
      ]);

      const candidates = [nextHold, nextTxn].filter(
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
        if (selected.kind === 'PENDING_HOLD') {
          holdsState.queue.shift();
        } else {
          txnsState.queue.shift();
        }
        continue;
      }

      if (selected.kind === 'PENDING_HOLD') {
        holdsState.queue.shift();
      } else {
        txnsState.queue.shift();
      }

      collected.push(selected);
      lastMarker = toMarker(selected);
    }

    const hasMore =
      holdsState.queue.length > 0 ||
      txnsState.queue.length > 0 ||
      Boolean(holdsState.nextToken) ||
      Boolean(txnsState.nextToken);

    const nextCursor = hasMore
      ? encodeCursor({
          holdsLek: holdsState.nextToken,
          txnsLek: txnsState.nextToken,
          holdsBuffer: holdsState.queue,
          txnsBuffer: txnsState.queue,
          last: lastMarker,
        })
      : undefined;

    const items = collected.map(toActivityItem);

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
