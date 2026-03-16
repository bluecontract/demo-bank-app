import { DocumentBootstrapRequestedSchema } from '@blue-repository/types/packages/conversation/schemas';
import type { LogEntry } from '../../ports';
import { blue } from '../../../blue';
import {
  getPayloadSummary,
  toBlueNode,
  toSimpleBlueRecord,
} from '../webhookUtils';
import { log, trace } from '../paynoteWebhook/logging';
import { getString, toSimpleRecord } from '../paynoteWebhook/utils';
import { resolveRuntimeDocument } from '../blueRuntime';
import { isPayNoteDeliveryDocument } from '../../payNoteDelivery/blueUtils';
import { isRecord } from '../typeGuards';
import type {
  HandlePayNoteDeliveryWebhookInput,
  HandlePayNoteDeliveryWebhookResult,
  WebhookPayload,
} from './types';
import type { BootstrapRequest } from './bootstrap';

export type DeliveryWebhookContext = {
  eventId: string;
  eventType?: string;
  eventObject?: WebhookPayload['object'];
  documentPayload?: Record<string, unknown>;
  emitted: unknown[];
  documentBootstrapRequests: BootstrapRequest[];
  isDeliveryDoc: boolean;
};

const extractDocumentBootstrapRequest = (
  event: unknown
): BootstrapRequest | null => {
  const node = toBlueNode(event);
  if (
    !node ||
    !blue.isTypeOf(node, DocumentBootstrapRequestedSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return null;
  }

  const payload = toSimpleBlueRecord(event);
  if (!payload) {
    return null;
  }

  const rawRecord = isRecord(event) ? event : null;
  const rawDocument = isRecord(rawRecord?.document) ? rawRecord.document : null;
  const payloadDocument = isRecord(payload.document) ? payload.document : null;

  return {
    rawEvent: event,
    request: payload,
    documentNode:
      toBlueNode(rawDocument) ?? toBlueNode(payloadDocument) ?? null,
    documentPayload: rawDocument ?? payloadDocument,
  };
};

const getCheckpointBootstrapRequestCandidates = (
  document: unknown
): unknown[] => {
  const record =
    toSimpleBlueRecord(document) ?? (isRecord(document) ? document : null);
  if (!record) {
    return [];
  }

  const checkpoint = toSimpleRecord(record.checkpoint);
  const lastEvents = toSimpleRecord(checkpoint?.lastEvents);
  if (!lastEvents) {
    return [];
  }

  return Object.values(lastEvents)
    .map(entry => {
      const message = toSimpleRecord(toSimpleRecord(entry)?.message);
      return message?.request;
    })
    .filter((request): request is unknown => request != null);
};

const dedupeBootstrapRequests = (
  requests: BootstrapRequest[]
): BootstrapRequest[] => {
  const seen = new Set<string>();

  return requests.filter(request => {
    const requestId =
      getString(request.request.requestId) ??
      getString(toSimpleRecord(request.request.requestId)?.value);
    const key = requestId ?? JSON.stringify(request.request);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
  const isDeliveryDoc = rawDocument
    ? isPayNoteDeliveryDocument(rawDocument)
    : false;
  const runtimeDocument = resolveRuntimeDocument(rawDocument);

  if (rawDocument && !runtimeDocument) {
    log(logs, 'warn', 'Document payload is unresolvable', {
      eventId,
      isDeliveryDoc,
    });
  }

  if (runtimeDocument && !runtimeDocument.resolved) {
    log(logs, 'warn', 'Document failed runtime resolution', {
      eventId,
      isDeliveryDoc,
    });
  }

  const documentPayload =
    runtimeDocument?.record ??
    (isRecord(rawDocument) ? rawDocument : undefined);

  const emitted = Array.isArray(eventObject?.emitted)
    ? eventObject?.emitted
    : [];
  const checkpointBootstrapRequests =
    rawDocument != null
      ? getCheckpointBootstrapRequestCandidates(rawDocument)
      : [];
  const documentBootstrapRequests = [...emitted, ...checkpointBootstrapRequests]
    .map(event => extractDocumentBootstrapRequest(event))
    .filter(
      (request): request is NonNullable<typeof request> => request !== null
    );
  const uniqueDocumentBootstrapRequests = dedupeBootstrapRequests(
    documentBootstrapRequests
  );

  trace(logs, 'PayNote Delivery webhook received', {
    eventId,
    eventType,
    sessionId: eventObject?.sessionId,
    hasDocument: Boolean(documentPayload),
    emittedCount: emitted.length,
    checkpointBootstrapRequestCount: checkpointBootstrapRequests.length,
    bootstrapRequestCount: uniqueDocumentBootstrapRequests.length,
    isDeliveryDoc,
  });

  return {
    context: {
      eventId,
      eventType,
      eventObject,
      documentPayload,
      emitted,
      documentBootstrapRequests: uniqueDocumentBootstrapRequests,
      isDeliveryDoc,
    },
  };
};
