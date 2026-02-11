import { DocumentBootstrapRequestedSchema } from '@blue-repository/types/packages/conversation/schemas';
import {
  CardTransactionCaptureLockRequestedSchema,
  CardTransactionCaptureUnlockRequestedSchema,
  CaptureFundsRequestedSchema,
  ReserveFundsAndCaptureImmediatelyRequestedSchema,
  ReserveFundsRequestedSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import { blue } from '../../../blue';
import type { WebhookEmittedEvent } from './types';
import { getString } from './utils';

export const RESERVE_FUNDS_EVENT_NAME = 'PayNote/Reserve Funds Requested';
export const CAPTURE_FUNDS_EVENT_NAME = 'PayNote/Capture Funds Requested';
export const CAPTURE_IMMEDIATELY_EVENT_NAME =
  'PayNote/Reserve Funds and Capture Immediately Requested';
export const CAPTURE_LOCK_REQUESTED_EVENT_NAME =
  'PayNote/Card Transaction Capture Lock Requested';
export const CAPTURE_UNLOCK_REQUESTED_EVENT_NAME =
  'PayNote/Card Transaction Capture Unlock Requested';
export const DOCUMENT_BOOTSTRAP_REQUESTED_EVENT_NAME =
  'Conversation/Document Bootstrap Requested';

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
    if (blue.isTypeOf(node, DocumentBootstrapRequestedSchema)) {
      return DOCUMENT_BOOTSTRAP_REQUESTED_EVENT_NAME;
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

export const resolveTransferRequestId = (
  event: WebhookEmittedEvent
): string | undefined => {
  try {
    const node = blue.jsonValueToNode(event);

    if (blue.isTypeOf(node, ReserveFundsRequestedSchema)) {
      const output = blue.nodeToSchemaOutput(node, ReserveFundsRequestedSchema);
      return getString(output.requestId);
    }

    if (blue.isTypeOf(node, CaptureFundsRequestedSchema)) {
      const output = blue.nodeToSchemaOutput(node, CaptureFundsRequestedSchema);
      return getString(output.requestId);
    }

    if (blue.isTypeOf(node, ReserveFundsAndCaptureImmediatelyRequestedSchema)) {
      const output = blue.nodeToSchemaOutput(
        node,
        ReserveFundsAndCaptureImmediatelyRequestedSchema
      );
      return getString(output.requestId);
    }
  } catch {
    // unsupported structure or unparsable event
  }
  return undefined;
};
