const TRANSACTION_PREFIX = 'TXN';
const HOLD_PREFIX = 'HOLD';

const encodePrefix = (value: string) => value.replace('#', '--');
const decodePrefix = (value: string) => value.replace('--', '#');

export const toRouteActivityId = (activityId: string) =>
  activityId.startsWith(`${TRANSACTION_PREFIX}#`) ||
  activityId.startsWith(`${HOLD_PREFIX}#`)
    ? encodePrefix(activityId)
    : activityId;

export const fromRouteActivityId = (activityId: string) =>
  activityId.startsWith(`${TRANSACTION_PREFIX}--`) ||
  activityId.startsWith(`${HOLD_PREFIX}--`)
    ? decodePrefix(activityId)
    : activityId;

export const buildTransactionDetailsPath = (
  accountId: string,
  activityId: string
) => `/transactions/${accountId}/${toRouteActivityId(activityId)}`;
