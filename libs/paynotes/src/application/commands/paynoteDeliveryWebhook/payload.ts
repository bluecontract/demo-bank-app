import type { LogEntry } from '../../ports';
import { getPayloadSummary } from '../webhookUtils';
import { log, trace } from '../paynoteWebhook/logging';
import { toSimpleRecord } from '../paynoteWebhook/utils';
import { isPayNoteDeliveryDocument } from '../../payNoteDelivery/blueUtils';
import type {
  HandlePayNoteDeliveryWebhookInput,
  HandlePayNoteDeliveryWebhookResult,
  WebhookPayload,
} from './types';
import {
  type BootstrapRequest,
  getDocumentBootstrapRequestFromEvent,
} from './bootstrap';

export type DeliveryWebhookContext = {
  eventId: string;
  eventType?: string;
  eventObject?: WebhookPayload['object'];
  documentPayload?: Record<string, unknown>;
  emitted: unknown[];
  documentBootstrapRequests: BootstrapRequest[];
  isDeliveryDoc: boolean;
};

export const resolveDeliveryWebhookContext = (
  input: HandlePayNoteDeliveryWebhookInput,
  logs: LogEntry[]
):
  | { context: DeliveryWebhookContext }
  | { result: HandlePayNoteDeliveryWebhookResult } => {
  const payload = input.payload as WebhookPayload;
  const eventId = input.eventId ?? payload?.id;
  const eventType = payload?.type;

  if (!eventId) {
    log(logs, 'warn', 'Webhook payload missing event id', {
      payloadSummary: getPayloadSummary(input.payload),
    });
    return { result: { handled: false, note: 'Missing event id', logs } };
  }

  const eventObject = payload?.object;
  const rawDocument = eventObject?.document;
  const documentPayload = toSimpleRecord(rawDocument) ?? undefined;

  const emitted = Array.isArray(eventObject?.emitted)
    ? eventObject?.emitted
    : [];
  const documentBootstrapRequests = emitted
    .map(event => getDocumentBootstrapRequestFromEvent(event))
    .filter(
      (request): request is NonNullable<typeof request> => request !== null
    );

  const isDeliveryDoc = rawDocument
    ? isPayNoteDeliveryDocument(rawDocument)
    : false;

  trace(logs, 'PayNote Delivery webhook received', {
    eventId,
    eventType,
    sessionId: eventObject?.sessionId,
    hasDocument: Boolean(documentPayload),
    emittedCount: emitted.length,
    bootstrapRequestCount: documentBootstrapRequests.length,
    documentBootstrapRequestCount: documentBootstrapRequests.length,
    isDeliveryDoc,
  });

  return {
    context: {
      eventId,
      eventType,
      eventObject,
      documentPayload,
      emitted,
      documentBootstrapRequests,
      isDeliveryDoc,
    },
  };
};
