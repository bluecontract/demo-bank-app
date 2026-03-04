import type { LogEntry } from '../../ports';
import { logMyOsFetchError } from './myosErrors';
import { logAndReturn, trace } from './logging';
import type {
  HandleWebhookEventDependencies,
  HandleWebhookEventInput,
  HandleWebhookEventResult,
  WebhookContext,
  WebhookEventPayload,
} from './types';
import { resolveRuntimeDocument } from '../blueRuntime';
import { getString, parsePayNoteDocument } from './utils';

const fetchEventMessages = {
  notFound: 'Failed to download PayNote event from MyOS',
  httpError: 'Failed to download PayNote event from MyOS',
  parseError: 'Failed to parse PayNote event payload',
  networkError: 'Unexpected error while downloading PayNote event',
};

const resolveEventEpoch = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

export type WebhookPayloadResolution =
  | { payload: WebhookEventPayload }
  | { result: HandleWebhookEventResult };

export const resolveWebhookPayload = async (
  input: HandleWebhookEventInput,
  deps: HandleWebhookEventDependencies,
  logs: LogEntry[]
): Promise<WebhookPayloadResolution> => {
  if (input.eventPayload) {
    return { payload: input.eventPayload as WebhookEventPayload };
  }

  const eventResult = await deps.myOsClient.fetchEvent(input.eventId);
  if (eventResult.kind !== 'success') {
    const note = logMyOsFetchError(
      eventResult,
      logs,
      { eventId: input.eventId },
      fetchEventMessages
    );
    return { result: { note, logs } };
  }

  trace(logs, 'Fetched PayNote event payload from MyOS', {
    eventId: input.eventId,
  });

  return { payload: eventResult.payload as WebhookEventPayload };
};

export const resolveWebhookContext = (
  payload: WebhookEventPayload,
  eventId: string,
  logs: LogEntry[]
): { context: WebhookContext } | { result: HandleWebhookEventResult } => {
  const eventObject = payload?.object;
  const eventType = payload?.type;
  const runtimeDocument = resolveRuntimeDocument(eventObject?.document);
  const document = runtimeDocument?.record;

  if (!document) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote event missing or unresolvable document payload',
      { eventId }
    );
    return { result: { note, logs } };
  }

  if (!parsePayNoteDocument(eventObject?.document)) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote event document payload failed PayNote type validation',
      { eventId }
    );
    return { result: { note, logs } };
  }

  const sessionId = getString(eventObject?.sessionId);
  if (!sessionId) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote event missing session id',
      { eventId }
    );
    return { result: { note, logs } };
  }

  const emittedEvents = Array.isArray(eventObject?.emitted)
    ? eventObject.emitted
    : undefined;
  const eventEpoch = resolveEventEpoch(eventObject?.epoch);

  return {
    context: {
      eventPayload: payload,
      eventObject,
      eventType,
      eventEpoch,
      document,
      emittedEvents,
      events: emittedEvents ?? [],
      sessionId,
    },
  };
};
