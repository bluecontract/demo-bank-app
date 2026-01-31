import {
  CardTransactionCaptureLockRequestedSchema,
  CardTransactionCaptureUnlockRequestedSchema,
  CaptureFundsRequestedSchema,
  ReserveFundsAndCaptureImmediatelyRequestedSchema,
  ReserveFundsRequestedSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import { blue } from '../../../blue';
import type { WebhookEmittedEvent } from './types';

export const RESERVE_FUNDS_EVENT_NAME = 'PayNote/Reserve Funds Requested';
export const CAPTURE_FUNDS_EVENT_NAME = 'PayNote/Capture Funds Requested';
export const CAPTURE_IMMEDIATELY_EVENT_NAME =
  'PayNote/Reserve Funds and Capture Immediately Requested';
export const CAPTURE_LOCK_REQUESTED_EVENT_NAME =
  'PayNote/Card Transaction Capture Lock Requested';
export const CAPTURE_UNLOCK_REQUESTED_EVENT_NAME =
  'PayNote/Card Transaction Capture Unlock Requested';

const resolveEventTypeLabel = (event: unknown): string | undefined => {
  if (!event || typeof event !== 'object') {
    return undefined;
  }
  const type = (event as { type?: unknown }).type;
  if (typeof type === 'string') {
    return type;
  }
  if (!type || typeof type !== 'object') {
    return undefined;
  }
  const typeRecord = type as { name?: unknown; value?: unknown };
  if (typeof typeRecord.name === 'string') {
    return typeRecord.name;
  }
  return typeof typeRecord.value === 'string' ? typeRecord.value : undefined;
};

const resolveEventType = (event: unknown): string | undefined => {
  if (!event || typeof event !== 'object') {
    return undefined;
  }

  try {
    const node = blue.jsonValueToNode(event);
    if (blue.isTypeOf(node, CardTransactionCaptureLockRequestedSchema)) {
      return CAPTURE_LOCK_REQUESTED_EVENT_NAME;
    }
    if (blue.isTypeOf(node, CardTransactionCaptureUnlockRequestedSchema)) {
      return CAPTURE_UNLOCK_REQUESTED_EVENT_NAME;
    }
    if (blue.isTypeOf(node, ReserveFundsAndCaptureImmediatelyRequestedSchema)) {
      return CAPTURE_IMMEDIATELY_EVENT_NAME;
    }
    if (blue.isTypeOf(node, CaptureFundsRequestedSchema)) {
      return CAPTURE_FUNDS_EVENT_NAME;
    }
    if (blue.isTypeOf(node, ReserveFundsRequestedSchema)) {
      return RESERVE_FUNDS_EVENT_NAME;
    }
  } catch {
    // ignore parse failures; the label fallback is handled separately
  }

  return undefined;
};

export const resolveEmittedEventType = (
  event: WebhookEmittedEvent
): string | undefined =>
  resolveEventType(event) ?? resolveEventTypeLabel(event);
