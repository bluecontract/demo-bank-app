import {
  MYOS_DOCUMENT_CREATED,
  MYOS_DOCUMENT_EPOCH_ADVANCED,
  type MyOsRelevantEvent,
} from './MyOsLiveClient';
import { sleep } from './wait';

export type EventPumpClient = {
  listRelevantDocumentEvents(input: {
    sessionIds: string[];
    from?: string;
    itemsPerPage?: number;
  }): Promise<MyOsRelevantEvent[]>;
  fetchEvent(eventId: string): Promise<unknown>;
};

export type EventPumpBankWebhook = {
  postPayNoteWebhookPayload(
    payload: unknown,
    headers?: Record<string, string>
  ): Promise<unknown>;
};

export type FlushUntilSettledInput = {
  sessionIds: string[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  idleQuietPeriodMs?: number;
  itemsPerPage?: number;
  assertSettled?: () => Promise<void> | void;
  afterEachDelivery?: (event: MyOsRelevantEvent) => Promise<void> | void;
};

const compareIsoTimestamps = (left?: string, right?: string) => {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
};

const sortWebhookEvents = (items: MyOsRelevantEvent[]) => {
  return [...items].sort((left, right) => {
    const leftPriority = left.type === MYOS_DOCUMENT_CREATED ? 0 : 2;
    const rightPriority = right.type === MYOS_DOCUMENT_CREATED ? 0 : 2;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (
      left.type === MYOS_DOCUMENT_EPOCH_ADVANCED &&
      right.type === MYOS_DOCUMENT_EPOCH_ADVANCED &&
      left.epoch !== right.epoch
    ) {
      return (
        (left.epoch ?? Number.POSITIVE_INFINITY) -
        (right.epoch ?? Number.POSITIVE_INFINITY)
      );
    }

    const byCreated = compareIsoTimestamps(left.createdAt, right.createdAt);
    if (byCreated !== 0) {
      return byCreated;
    }

    return left.id.localeCompare(right.id);
  });
};

const extractString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;

export const buildTestWebhookHeaders = (
  payload: unknown,
  fallbackDeliveryId?: string
): Record<string, string> => {
  const record =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const id = extractString(record.id) ?? fallbackDeliveryId ?? 'pull-and-post';
  const type = extractString(record.type) ?? 'UNKNOWN';

  return {
    'content-type': 'application/json',
    'x-myos-delivery-id': fallbackDeliveryId ?? `pull-and-post:${id}`,
    'x-myos-webhook-id': 'pull-and-post',
    'x-myos-event-id': id,
    'x-myos-event-type': type,
    'x-myos-timestamp': String(Math.floor(Date.now() / 1000)),
  };
};

/**
 * Explicit sync point used by tests.
 *
 * The test calls this helper after a business action.
 * The helper internally polls MyOS, forwards only DOCUMENT_CREATED /
 * DOCUMENT_EPOCH_ADVANCED, posts the full webhook payload to the bank, and
 * waits for a short quiet period plus an optional bank-side settled assertion.
 */
export class EventPump {
  private from: string | undefined;
  private readonly processedEventIds = new Set<string>();

  constructor(
    private readonly client: EventPumpClient,
    private readonly bank: EventPumpBankWebhook
  ) {}

  async flushUntilSettled(input: FlushUntilSettledInput) {
    const timeoutMs = input.timeoutMs ?? 30_000;
    const pollIntervalMs = input.pollIntervalMs ?? 1_000;
    const idleQuietPeriodMs = input.idleQuietPeriodMs ?? 1_500;
    const deadlineAt = Date.now() + timeoutMs;
    const delivered: string[] = [];
    let lastProgressAt = Date.now();

    while (Date.now() < deadlineAt) {
      const listed = await this.client.listRelevantDocumentEvents({
        sessionIds: input.sessionIds,
        from: this.from,
        itemsPerPage: input.itemsPerPage,
      });

      const unseen = sortWebhookEvents(
        listed.filter(item => !this.processedEventIds.has(item.id))
      );

      if (unseen.length > 0) {
        for (const item of unseen) {
          const payload = await this.client.fetchEvent(item.id);
          this.processedEventIds.add(item.id);
          delivered.push(item.id);
          await this.bank.postPayNoteWebhookPayload(
            payload,
            buildTestWebhookHeaders(payload)
          );
          await input.afterEachDelivery?.(item);
          if (
            !this.from ||
            compareIsoTimestamps(item.createdAt, this.from) > 0
          ) {
            this.from = item.createdAt;
          }
        }
        lastProgressAt = Date.now();
        continue;
      }

      if (input.assertSettled) {
        try {
          await input.assertSettled();
          const quietForMs = Date.now() - lastProgressAt;
          if (delivered.length > 0 && quietForMs >= idleQuietPeriodMs) {
            return delivered;
          }
        } catch {
          // keep polling until timeout
        }
      } else {
        const quietForMs = Date.now() - lastProgressAt;
        if (delivered.length > 0 && quietForMs >= idleQuietPeriodMs) {
          return delivered;
        }
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Event pump timeout after ${timeoutMs}ms. Delivered events: ${
        delivered.join(', ') || 'none'
      }`
    );
  }
}
