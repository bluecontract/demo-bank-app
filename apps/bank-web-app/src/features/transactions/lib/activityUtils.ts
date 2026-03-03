import type { ActivityItem } from '../hooks/useActivity';

type HoldActivityItem = Exclude<ActivityItem, { kind: 'POSTED_TRANSACTION' }>;

const getHoldStatePriority = (item: HoldActivityItem): number => {
  switch (item.kind) {
    case 'HOLD_CREATED':
      return 0;
    case 'HOLD_FAILED':
    case 'HOLD_RELEASED':
      return 1;
    case 'HOLD_CAPTURED':
      return 2;
  }
};

const shouldReplaceHoldState = (
  existing: HoldActivityItem,
  next: HoldActivityItem
) => {
  const existingTimestamp = Date.parse(getActivityTimestamp(existing));
  const nextTimestamp = Date.parse(getActivityTimestamp(next));
  const hasExistingTimestamp = !Number.isNaN(existingTimestamp);
  const hasNextTimestamp = !Number.isNaN(nextTimestamp);

  // Prefer newer timestamps when both are valid and different.
  if (
    hasExistingTimestamp &&
    hasNextTimestamp &&
    nextTimestamp !== existingTimestamp
  ) {
    return nextTimestamp > existingTimestamp;
  }

  // Otherwise fall back to lifecycle priority.
  const existingPriority = getHoldStatePriority(existing);
  const nextPriority = getHoldStatePriority(next);
  if (nextPriority !== existingPriority) {
    return nextPriority > existingPriority;
  }

  // If priority ties, prefer the one with a valid timestamp.
  return !hasExistingTimestamp && hasNextTimestamp;
};

export const getHoldEventTimestamp = (item: ActivityItem) => {
  if (item.kind === 'HOLD_CREATED') {
    return item.createdAt;
  }
  if (item.kind === 'HOLD_CAPTURED') {
    return item.capturedAt;
  }
  if (item.kind === 'HOLD_RELEASED') {
    return item.releasedAt;
  }
  if (item.kind === 'HOLD_FAILED') {
    return item.failedAt;
  }
  return '';
};

export const getActivityTimestamp = (item: ActivityItem) => {
  if (item.kind === 'POSTED_TRANSACTION') {
    return item.postedAt;
  }
  return getHoldEventTimestamp(item);
};

export const getActivityLifecycleGroupKey = (item: ActivityItem): string => {
  if (item.kind === 'POSTED_TRANSACTION') {
    if (item.originHoldId) {
      return `hold-${item.originHoldId}`;
    }
    if (item.processorChargeId) {
      return `charge-${item.processorChargeId}`;
    }
    return `txn-${item.transactionId}`;
  }

  return `hold-${item.holdId}`;
};

export const collapseActivityLifecycle = (
  items: ActivityItem[]
): ActivityItem[] => {
  if (!items.length) {
    return items;
  }
  const holdIds = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'POSTED_TRANSACTION') {
      holdIds.add(item.holdId);
    }
  }

  // Hide settlement POSTED_TRANSACTION rows that only mirror a hold-origin flow.
  const withoutMirroredPostedRows = items.filter(item => {
    if (item.kind !== 'POSTED_TRANSACTION') {
      return true;
    }
    if (!item.originHoldId) {
      return true;
    }
    return !holdIds.has(item.originHoldId);
  });

  // Keep only the most recent state for each hold in the top-level list.
  const latestHoldStateById = new Map<string, HoldActivityItem>();
  for (const item of withoutMirroredPostedRows) {
    if (item.kind === 'POSTED_TRANSACTION') {
      continue;
    }

    const existing = latestHoldStateById.get(item.holdId);
    if (!existing) {
      latestHoldStateById.set(item.holdId, item);
      continue;
    }
    if (shouldReplaceHoldState(existing, item)) {
      latestHoldStateById.set(item.holdId, item);
    }
  }

  return withoutMirroredPostedRows.filter(item => {
    if (item.kind === 'POSTED_TRANSACTION') {
      return true;
    }
    return latestHoldStateById.get(item.holdId) === item;
  });
};

export const getActivityKey = (item: ActivityItem) =>
  item.kind === 'POSTED_TRANSACTION'
    ? `txn-${item.transactionId}`
    : `hold-${item.holdId}-${item.kind}-${getHoldEventTimestamp(item)}`;

export const getCardGroupKeys = (item: ActivityItem) => {
  const keys: string[] = [];
  if (item.kind === 'POSTED_TRANSACTION') {
    if (item.originHoldId) {
      keys.push(`hold-${item.originHoldId}`);
    }
  } else {
    keys.push(`hold-${item.holdId}`);
  }

  if (item.processorChargeId) {
    keys.push(`charge-${item.processorChargeId}`);
  }

  return keys;
};

export const filterActivityByCardGroups = (
  activityItems: ActivityItem[],
  matchesCardContext: (item: ActivityItem) => boolean
) => {
  if (!activityItems.length) {
    return activityItems;
  }

  const groupKeys = new Set<string>();
  activityItems.forEach(item => {
    if (matchesCardContext(item)) {
      getCardGroupKeys(item).forEach(key => groupKeys.add(key));
    }
  });

  return activityItems.filter(
    item =>
      matchesCardContext(item) ||
      getCardGroupKeys(item).some(key => groupKeys.has(key))
  );
};
