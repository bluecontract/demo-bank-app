import type { LogEntry } from '../../ports';
import {
  CAPTURE_FUNDS_EVENT_NAME,
  CAPTURE_IMMEDIATELY_EVENT_NAME,
  CAPTURE_LOCK_REQUESTED_EVENT_NAME,
  CAPTURE_UNLOCK_REQUESTED_EVENT_NAME,
  DOCUMENT_BOOTSTRAP_REQUESTED_EVENT_NAME,
  RESERVE_FUNDS_EVENT_NAME,
  START_CARD_TRANSACTION_MONITORING_REQUESTED_EVENT_NAME,
  resolveEmittedEventType,
} from './events';
import { trace } from './logging';
import type { WebhookEmittedEvent } from './types';

const CAPTURE_EVENT_TYPES = new Set<string>([
  CAPTURE_LOCK_REQUESTED_EVENT_NAME,
  CAPTURE_UNLOCK_REQUESTED_EVENT_NAME,
]);

const TRANSFER_EVENT_TYPES = new Set<string>([
  CAPTURE_IMMEDIATELY_EVENT_NAME,
  CAPTURE_FUNDS_EVENT_NAME,
  RESERVE_FUNDS_EVENT_NAME,
]);

const MONITORING_EVENT_TYPES = new Set<string>([
  START_CARD_TRANSACTION_MONITORING_REQUESTED_EVENT_NAME,
]);

export type PayNoteEventDispatchDecision =
  | 'capture-request'
  | 'transfer'
  | 'monitoring-request'
  | 'document-bootstrap-requested'
  | 'unsupported';

export type ClassifiedPayNoteEvent = {
  event: WebhookEmittedEvent;
  eventType?: string;
  decision: PayNoteEventDispatchDecision;
};

export type DispatchedTransferEvent = {
  event: WebhookEmittedEvent;
  eventType?: string;
  eventIndex: number;
};

export const classifyPayNoteEvent = (
  event: WebhookEmittedEvent
): ClassifiedPayNoteEvent => {
  const eventType = resolveEmittedEventType(event);

  if (eventType && CAPTURE_EVENT_TYPES.has(eventType)) {
    return {
      event,
      eventType,
      decision: 'capture-request',
    };
  }

  if (eventType && TRANSFER_EVENT_TYPES.has(eventType)) {
    return {
      event,
      eventType,
      decision: 'transfer',
    };
  }

  if (eventType && MONITORING_EVENT_TYPES.has(eventType)) {
    return {
      event,
      eventType,
      decision: 'monitoring-request',
    };
  }

  if (eventType === DOCUMENT_BOOTSTRAP_REQUESTED_EVENT_NAME) {
    return {
      event,
      eventType,
      decision: 'document-bootstrap-requested',
    };
  }

  return {
    event,
    eventType,
    decision: 'unsupported',
  };
};

export const dispatchPayNoteEvents = (input: {
  events: WebhookEmittedEvent[];
  eventId: string;
  payNoteDocumentId: string;
  logs: LogEntry[];
}): {
  captureRequestEvents: WebhookEmittedEvent[];
  transferEvents: DispatchedTransferEvent[];
  monitoringRequestEvents: Array<{
    event: WebhookEmittedEvent;
    eventType?: string;
    eventIndex: number;
  }>;
} => {
  const { events, eventId, payNoteDocumentId, logs } = input;

  const captureRequestEvents: WebhookEmittedEvent[] = [];
  const transferEvents: DispatchedTransferEvent[] = [];
  const monitoringRequestEvents: Array<{
    event: WebhookEmittedEvent;
    eventType?: string;
    eventIndex: number;
  }> = [];

  for (const [eventIndex, event] of events.entries()) {
    const classified = classifyPayNoteEvent(event);

    trace(logs, 'Dispatching PayNote emitted event', {
      eventId,
      payNoteDocumentId,
      eventIndex,
      eventType: classified.eventType ?? null,
      decision: classified.decision,
    });

    if (classified.decision === 'capture-request') {
      captureRequestEvents.push(classified.event);
      continue;
    }

    if (classified.decision === 'transfer') {
      transferEvents.push({
        event: classified.event,
        eventType: classified.eventType,
        eventIndex,
      });
      continue;
    }

    if (classified.decision === 'monitoring-request') {
      monitoringRequestEvents.push({
        event: classified.event,
        eventType: classified.eventType,
        eventIndex,
      });
      continue;
    }

    if (classified.decision === 'document-bootstrap-requested') {
      logs.push({
        level: 'info',
        message:
          'PayNote emitted event intentionally ignored (Document Bootstrap Requested handled by delivery pipeline)',
        context: {
          eventId,
          payNoteDocumentId,
          eventIndex,
          eventType: classified.eventType,
        },
      });
      continue;
    }

    logs.push({
      level: 'info',
      message: 'PayNote emitted event intentionally ignored (unsupported type)',
      context: {
        eventId,
        payNoteDocumentId,
        eventIndex,
        eventType: classified.eventType ?? null,
      },
    });
  }

  return {
    captureRequestEvents,
    transferEvents,
    monitoringRequestEvents,
  };
};
