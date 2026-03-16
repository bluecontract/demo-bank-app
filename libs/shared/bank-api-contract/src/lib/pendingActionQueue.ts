type PendingActionQueueItem = {
  status?: string;
  queueOrder?: number;
  minSummaryEpoch?: number;
};

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const resolveCurrentSummaryEpoch = (value: unknown): number => {
  return asFiniteNumber(value) ?? 0;
};

const resolveQueueOrder = (
  action: PendingActionQueueItem,
  index: number
): number => {
  const queueOrder = asFiniteNumber(action.queueOrder);
  return queueOrder !== null ? queueOrder : index;
};

const resolveMinSummaryEpoch = (action: PendingActionQueueItem): number => {
  const minSummaryEpoch = asFiniteNumber(action.minSummaryEpoch);
  return minSummaryEpoch !== null ? minSummaryEpoch : 0;
};

export const resolveActivePendingAction = <
  T extends PendingActionQueueItem
>(input: {
  actions: T[];
  currentSummaryEpoch: number;
}): T | null => {
  const pendingActions = input.actions
    .map((action, index) => ({ action, index }))
    .filter(item => item.action.status === 'pending')
    .sort(
      (left, right) =>
        resolveQueueOrder(left.action, left.index) -
        resolveQueueOrder(right.action, right.index)
    );

  if (pendingActions.length === 0) {
    return null;
  }

  const queueHead = pendingActions[0].action;
  return input.currentSummaryEpoch >= resolveMinSummaryEpoch(queueHead)
    ? queueHead
    : null;
};
