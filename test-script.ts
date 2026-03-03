/* eslint-disable @nx/enforce-module-boundaries */
import type { ActivityItem } from './apps/bank-web-app/src/features/transactions/hooks/useActivity';
import { collapseActivityLifecycle } from './apps/bank-web-app/src/features/transactions/lib/activityUtils';

const holdCaptured = {
  kind: 'HOLD_CAPTURED',
  activityId: 'HOLD#1',
  holdId: '1',
  amountMinor: 5000,
  createdAt: '2024-03-20T10:00:00Z',
  capturedAt: '2024-03-20T10:00:00Z',
} as ActivityItem;

const holdCreated = {
  kind: 'HOLD_CREATED',
  activityId: 'HOLD#1',
  holdId: '1',
  amountMinor: 5000,
  createdAt: '2024-03-20T10:00:00Z',
} as ActivityItem;

const result = collapseActivityLifecycle([holdCaptured, holdCreated]);
console.log(result.map(r => r.kind));
