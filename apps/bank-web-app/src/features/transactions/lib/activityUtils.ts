import type { ActivityItem } from '../hooks/useActivity';

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
  const holdIds = new Set(
    items
      .filter(
        (item): item is Exclude<ActivityItem, { kind: 'POSTED_TRANSACTION' }> =>
          item.kind !== 'POSTED_TRANSACTION'
      )
      .map(item => item.holdId)
  );

  // Keep full hold history (including partial captures), but hide
  // settlement POSTED_TRANSACTION rows that only mirror a hold-origin flow.
  return items.filter(item => {
    if (
      item.kind === 'POSTED_TRANSACTION' &&
      item.originHoldId &&
      holdIds.has(item.originHoldId)
    ) {
      return false;
    }
    return true;
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
