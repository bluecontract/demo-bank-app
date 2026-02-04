import { useMemo } from 'react';
import type { ActivityItem } from './useActivity';
import { getActivityTimestamp } from '../lib/activityUtils';

interface UseRelatedActivityItemsInput {
  activityItems: ActivityItem[];
  relatedTransactionIds?: string[];
  relatedHoldIds?: string[];
}

export const useRelatedActivityItems = ({
  activityItems,
  relatedTransactionIds = [],
  relatedHoldIds = [],
}: UseRelatedActivityItemsInput) => {
  const activityByTransactionId = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const item of activityItems) {
      if (item.kind === 'POSTED_TRANSACTION') {
        map.set(item.transactionId, item);
      }
    }
    return map;
  }, [activityItems]);

  const activityByHoldId = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const item of activityItems) {
      if (item.kind === 'POSTED_TRANSACTION') {
        continue;
      }

      const existing = map.get(item.holdId);
      if (!existing) {
        map.set(item.holdId, item);
        continue;
      }

      const existingTime = Date.parse(getActivityTimestamp(existing));
      const nextTime = Date.parse(getActivityTimestamp(item));
      if (Number.isNaN(existingTime) || nextTime > existingTime) {
        map.set(item.holdId, item);
      }
    }

    return map;
  }, [activityItems]);

  const relatedTransactionItems = useMemo(
    () =>
      relatedTransactionIds
        .map(txnId => activityByTransactionId.get(txnId))
        .filter((item): item is ActivityItem => Boolean(item)),
    [activityByTransactionId, relatedTransactionIds]
  );

  const relatedHoldItems = useMemo(
    () =>
      relatedHoldIds
        .map(holdId => activityByHoldId.get(holdId))
        .filter((item): item is ActivityItem => Boolean(item)),
    [activityByHoldId, relatedHoldIds]
  );

  const missingTransactionIds = useMemo(
    () =>
      relatedTransactionIds.filter(txnId => !activityByTransactionId.has(txnId)),
    [activityByTransactionId, relatedTransactionIds]
  );

  const missingHoldIds = useMemo(
    () => relatedHoldIds.filter(holdId => !activityByHoldId.has(holdId)),
    [activityByHoldId, relatedHoldIds]
  );

  return {
    relatedTransactionItems,
    relatedHoldItems,
    missingTransactionIds,
    missingHoldIds,
    activityByTransactionId,
    activityByHoldId,
  };
};
