import {
  DocumentSessionBootstrapSchema,
  TargetDocumentSessionStartedSchema,
} from '@blue-repository/types/packages/myos/schemas';
import type {
  BootstrapContextRepository,
  ClockPort,
  LogEntry,
  MyOsClient,
  PendingBootstrapEventRepository,
  PayNoteBootstrapRepository,
  PayNoteDeliveryRepository,
  PayNoteRepository,
  PayNoteRecord,
} from '../ports';
import type { HoldRepository } from '@demo-bank-app/banking';
import type { ContractRepository } from '@demo-bank-app/contracts';
import { blue } from '../../blue';
import { isPayNoteDocument } from '../payNoteDelivery/blueUtils';
import { upsertPayNoteContractRecord } from './payNoteContractUtils';
import { updateHoldPayNoteDocumentId } from './payNoteHoldUtils';
import { mergeSessionIds } from './payNoteSessionUtils';
import { log, trace } from './paynoteWebhook/logging';
import { logMyOsFetchError } from './paynoteWebhook/myosErrors';
import { getPayloadSummary, toBlueNode } from './webhookUtils';

export interface HandlePayNoteBootstrapWebhookInput {
  payload: unknown;
  eventId?: string;
  skipEventIdempotencyClaim?: boolean;
  skipPendingBuffer?: boolean;
}

export interface HandlePayNoteBootstrapWebhookDependencies {
  myOsClient: MyOsClient;
  payNoteRepository: PayNoteRepository;
  payNoteDeliveryRepository: PayNoteDeliveryRepository;
  payNoteBootstrapRepository: PayNoteBootstrapRepository;
  bootstrapContextRepository: BootstrapContextRepository;
  pendingBootstrapEventRepository: PendingBootstrapEventRepository;
  contractRepository: ContractRepository;
  holdRepository: HoldRepository;
  clock: ClockPort;
}

export interface HandlePayNoteBootstrapWebhookResult {
  handled: boolean;
  note?: string;
  logs: LogEntry[];
}

export interface ConsumePendingPayNoteBootstrapEventsInput {
  bootstrapSessionId: string;
}

export interface ConsumePendingPayNoteBootstrapEventsResult {
  handled: boolean;
  consumedCount: number;
  remainingCount: number;
  logs: LogEntry[];
}

const updateHoldPayNoteDocumentIdForBootstrap = async (
  logs: LogEntry[],
  holdId: string,
  payNoteDocumentId: string,
  deps: HandlePayNoteBootstrapWebhookDependencies,
  context?: { eventId?: string; deliveryId?: string }
) => {
  if (!payNoteDocumentId) {
    return;
  }
  const hold = await deps.holdRepository.getHold(holdId);
  if (!hold) {
    trace(logs, 'Hold missing while linking PayNote document', {
      eventId: context?.eventId,
      deliveryId: context?.deliveryId,
      holdId,
    });
    return;
  }
  await updateHoldPayNoteDocumentId({
    logs,
    hold,
    holdRepository: deps.holdRepository,
    payNoteDocumentId,
    context,
    message: 'Hold PayNote reference updated after bootstrap',
  });
};

const getTargetSessionIds = (event: unknown): string[] | null => {
  const node = toBlueNode(event);
  if (
    !node ||
    !blue.isTypeOf(node, TargetDocumentSessionStartedSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return null;
  }

  const output = blue.nodeToSchemaOutput(
    node,
    TargetDocumentSessionStartedSchema
  );
  if (output.initiatorSessionIds?.length) {
    return output.initiatorSessionIds.filter(id => id && id.trim().length > 0);
  }

  const simple = blue.nodeToJson(node, 'simple') as
    | Record<string, unknown>
    | undefined;
  const fallbackSingle = simple?.initiatorSessionId;
  if (typeof fallbackSingle === 'string' && fallbackSingle.trim().length > 0) {
    return [fallbackSingle];
  }
  const fallbackArray = simple?.initiatorSessionIds;
  if (Array.isArray(fallbackArray)) {
    const ids = fallbackArray.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
    return ids.length ? ids : [];
  }
  return [];
};

const isDocumentSessionBootstrap = (document: unknown): boolean => {
  const node = toBlueNode(document);
  if (!node) {
    return false;
  }
  return blue.isTypeOf(node, DocumentSessionBootstrapSchema, {
    checkSchemaExtensions: true,
  });
};

const fetchDocumentMessages = {
  notFound: 'Failed to resolve PayNote document from MyOS',
  httpError: 'Failed to resolve PayNote document from MyOS',
  parseError: 'Failed to parse PayNote document response',
  networkError: 'Unexpected error resolving PayNote document',
};

const fetchEventMessages = {
  notFound: 'Failed to resolve pending bootstrap event from MyOS',
  httpError: 'Failed to resolve pending bootstrap event from MyOS',
  parseError: 'Failed to parse pending bootstrap event response',
  networkError: 'Unexpected error resolving pending bootstrap event',
};

const PENDING_BOOTSTRAP_EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;

const resolvePayNoteDocument = async (
  sessionId: string,
  logs: LogEntry[],
  deps: HandlePayNoteBootstrapWebhookDependencies
): Promise<{
  documentId: string;
  document?: Record<string, unknown>;
} | null> => {
  const result = await deps.myOsClient.fetchDocument(sessionId);
  if (result.kind !== 'success') {
    logMyOsFetchError(result, logs, { sessionId }, fetchDocumentMessages);
    return null;
  }

  return {
    documentId: result.document.documentId,
    document: result.document.document,
  };
};

const mergePayNoteRecord = (
  existing: PayNoteRecord | null,
  updates: Partial<PayNoteRecord> & {
    payNoteDocumentId: string;
    updatedAt: string;
  }
): PayNoteRecord => {
  const createdAt =
    existing?.createdAt ?? updates.createdAt ?? updates.updatedAt;
  return {
    payNoteDocumentId: updates.payNoteDocumentId,
    sessionIds: mergeSessionIds(existing?.sessionIds, updates.sessionIds),
    deliveryId: updates.deliveryId ?? existing?.deliveryId,
    accountNumber: updates.accountNumber ?? existing?.accountNumber,
    userId: updates.userId ?? existing?.userId,
    holdId: updates.holdId ?? existing?.holdId,
    transactionId: updates.transactionId ?? existing?.transactionId,
    merchantId: updates.merchantId ?? existing?.merchantId,
    payerAccountNumber:
      updates.payerAccountNumber ?? existing?.payerAccountNumber,
    payeeAccountNumber:
      updates.payeeAccountNumber ?? existing?.payeeAccountNumber,
    document: updates.document ?? existing?.document,
    transactionRequest: existing?.transactionRequest ?? null,
    triggerEvent: existing?.triggerEvent ?? null,
    createdAt,
    updatedAt: updates.updatedAt,
  };
};

const bufferPendingBootstrapEvent = async (input: {
  eventId: string;
  bootstrapSessionId: string;
  now: string;
  logs: LogEntry[];
  deps: HandlePayNoteBootstrapWebhookDependencies;
}): Promise<void> => {
  const { eventId, bootstrapSessionId, now, logs, deps } = input;
  const ttl =
    Math.floor(new Date(now).getTime() / 1000) +
    PENDING_BOOTSTRAP_EVENT_TTL_SECONDS;

  try {
    await deps.pendingBootstrapEventRepository.addPending({
      bootstrapSessionId,
      eventId,
      createdAt: now,
      ttl,
    });

    log(logs, 'info', 'Buffered bootstrap event (missing context)', {
      eventId,
      bootstrapSessionId,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      trace(logs, 'Bootstrap event already buffered', {
        eventId,
        bootstrapSessionId,
      });
      return;
    }

    throw error;
  }
};

export const handlePayNoteBootstrapWebhookEvent = async (
  input: HandlePayNoteBootstrapWebhookInput,
  deps: HandlePayNoteBootstrapWebhookDependencies
): Promise<HandlePayNoteBootstrapWebhookResult> => {
  const logs: LogEntry[] = [];
  const payload = input.payload as {
    id?: string;
    object?: {
      sessionId?: string;
      document?: unknown;
      emitted?: unknown[];
      created?: string;
    };
  };

  const eventId = input.eventId ?? payload?.id;
  if (!eventId) {
    log(logs, 'warn', 'Webhook payload missing event id', {
      payloadSummary: getPayloadSummary(input.payload),
    });
    return { handled: false, note: 'Missing event id', logs };
  }

  const eventObject = payload?.object;
  const documentPayload = eventObject?.document;

  trace(logs, 'PayNote bootstrap webhook received', {
    eventId,
    sessionId: eventObject?.sessionId,
    hasDocument: Boolean(documentPayload),
    emittedCount: Array.isArray(eventObject?.emitted)
      ? eventObject?.emitted.length
      : 0,
  });

  if (!documentPayload || !isDocumentSessionBootstrap(documentPayload)) {
    trace(logs, 'Bootstrap webhook skipped (not a bootstrap document)', {
      eventId,
      sessionId: eventObject?.sessionId,
    });
    return { handled: false, logs };
  }

  const now = deps.clock.now().toISOString();

  if (!input.skipEventIdempotencyClaim) {
    const firstProcess =
      await deps.payNoteDeliveryRepository.markEventProcessed(eventId);
    if (!firstProcess) {
      log(logs, 'info', 'PayNote bootstrap webhook already processed', {
        eventId,
      });
      return { handled: true, logs };
    }
  }

  const bootstrapSessionId =
    typeof eventObject?.sessionId === 'string'
      ? eventObject.sessionId
      : undefined;

  const emittedEvents = Array.isArray(eventObject?.emitted)
    ? eventObject.emitted
    : undefined;
  const emitted = emittedEvents ?? [];
  const targetEvents = emitted
    .map(event => ({ event, sessionIds: getTargetSessionIds(event) }))
    .filter(
      (item): item is { event: unknown; sessionIds: string[] } =>
        item.sessionIds !== null
    );

  if (!targetEvents.length) {
    log(logs, 'info', 'No target session events found in bootstrap update', {
      eventId,
      bootstrapSessionId,
    });
    return { handled: true, logs };
  }

  const deliveryRecord = bootstrapSessionId
    ? await deps.payNoteDeliveryRepository.getDeliveryByBootstrapSessionId(
        bootstrapSessionId
      )
    : null;

  const bootstrapRecord = bootstrapSessionId
    ? await deps.payNoteBootstrapRepository.getBootstrapBySessionId(
        bootstrapSessionId
      )
    : null;
  const bootstrapContext = bootstrapSessionId
    ? await deps.bootstrapContextRepository.getContextBySessionId(
        bootstrapSessionId
      )
    : null;

  if (!deliveryRecord && !bootstrapRecord) {
    if (bootstrapSessionId && !input.skipPendingBuffer) {
      await bufferPendingBootstrapEvent({
        eventId,
        bootstrapSessionId,
        now,
        logs,
        deps,
      });
      return {
        handled: true,
        note: 'Buffered waiting for bootstrap context',
        logs,
      };
    }

    log(logs, 'info', 'Bootstrap event deferred (no matching context)', {
      eventId,
      bootstrapSessionId,
    });
    return {
      handled: true,
      note: 'Deferred waiting for bootstrap context',
      logs,
    };
  }

  trace(logs, 'Bootstrap context resolved', {
    eventId,
    bootstrapSessionId,
    hasDeliveryRecord: Boolean(deliveryRecord),
    hasBootstrapRecord: Boolean(bootstrapRecord),
  });

  for (const { sessionIds } of targetEvents) {
    if (!sessionIds.length) {
      log(logs, 'warn', 'Target session event missing session ids', {
        eventId,
      });
      continue;
    }

    trace(logs, 'Bootstrap target session ids resolved', {
      eventId,
      bootstrapSessionId,
      sessionIds,
    });

    for (const sessionId of sessionIds) {
      const resolved = await resolvePayNoteDocument(sessionId, logs, deps);
      if (!resolved) {
        continue;
      }

      const isPayNote = resolved.document
        ? isPayNoteDocument(resolved.document)
        : true;

      trace(logs, 'Resolved paynote document from session', {
        eventId,
        sessionId,
        payNoteDocumentId: resolved.documentId,
        isPayNote,
      });

      if (!isPayNote) {
        log(logs, 'info', 'Bootstrap target is not a PayNote document', {
          eventId,
          sessionId,
          documentId: resolved.documentId,
        });
        continue;
      }

      const payNoteDocumentId = resolved.documentId;
      const existingPayNote = await deps.payNoteRepository.getPayNote(
        payNoteDocumentId
      );

      const updatedRecord = mergePayNoteRecord(existingPayNote, {
        payNoteDocumentId,
        sessionIds: [sessionId],
        deliveryId: deliveryRecord?.deliveryId,
        accountNumber:
          deliveryRecord?.accountNumber ?? bootstrapRecord?.accountNumber,
        userId: deliveryRecord?.userId ?? bootstrapRecord?.userId,
        holdId: deliveryRecord?.holdId,
        transactionId: deliveryRecord?.transactionId,
        merchantId: deliveryRecord?.merchantId ?? bootstrapContext?.merchantId,
        payerAccountNumber:
          bootstrapRecord?.payerAccountNumber ??
          deliveryRecord?.accountNumber ??
          existingPayNote?.payerAccountNumber,
        payeeAccountNumber:
          bootstrapRecord?.payeeAccountNumber ??
          existingPayNote?.payeeAccountNumber,
        document: resolved.document,
        createdAt: existingPayNote?.createdAt ?? now,
        updatedAt: now,
      });

      await deps.payNoteRepository.savePayNote(updatedRecord);
      await upsertPayNoteContractRecord({
        contractRepository: deps.contractRepository,
        updatedRecord,
        sessionId,
        documentId: payNoteDocumentId,
        document: resolved.document,
        emittedEvents,
        now,
      });

      if (deliveryRecord) {
        const updatedDelivery = {
          ...deliveryRecord,
          payNoteDocumentId:
            deliveryRecord.payNoteDocumentId ?? payNoteDocumentId,
          payNoteSessionIds: mergeSessionIds(deliveryRecord.payNoteSessionIds, [
            sessionId,
          ]),
          payNoteDocument: resolved.document ?? deliveryRecord.payNoteDocument,
          payNoteUpdatedAt: eventObject?.created ?? now,
          payNoteBootstrapSessionId:
            deliveryRecord.payNoteBootstrapSessionId ?? bootstrapSessionId,
          updatedAt: now,
        };

        await deps.payNoteDeliveryRepository.saveDelivery(updatedDelivery);
      }

      if (deliveryRecord?.holdId) {
        await updateHoldPayNoteDocumentIdForBootstrap(
          logs,
          deliveryRecord.holdId,
          payNoteDocumentId,
          deps,
          { eventId, deliveryId: deliveryRecord.deliveryId }
        );
      }

      log(logs, 'info', 'PayNote bootstrap linked', {
        eventId,
        bootstrapSessionId,
        payNoteDocumentId,
        sessionId,
        deliveryId: deliveryRecord?.deliveryId,
      });
    }
  }

  return { handled: true, logs };
};

export const consumePendingPayNoteBootstrapEvents = async (
  input: ConsumePendingPayNoteBootstrapEventsInput,
  deps: HandlePayNoteBootstrapWebhookDependencies
): Promise<ConsumePendingPayNoteBootstrapEventsResult> => {
  const logs: LogEntry[] = [];
  const bootstrapSessionId = input.bootstrapSessionId?.trim();

  if (!bootstrapSessionId) {
    log(
      logs,
      'warn',
      'Pending bootstrap consumption skipped (missing session)',
      {
        bootstrapSessionId: input.bootstrapSessionId,
      }
    );
    return { handled: false, consumedCount: 0, remainingCount: 0, logs };
  }

  const pendingEvents = await deps.pendingBootstrapEventRepository.listPending(
    bootstrapSessionId
  );

  if (!pendingEvents.length) {
    trace(logs, 'No pending bootstrap events to consume', {
      bootstrapSessionId,
    });
    return { handled: true, consumedCount: 0, remainingCount: 0, logs };
  }

  let consumedCount = 0;
  let remainingCount = 0;

  for (const pendingEvent of pendingEvents) {
    const { eventId } = pendingEvent;
    const eventResult = await deps.myOsClient.fetchEvent(eventId);

    if (eventResult.kind !== 'success') {
      remainingCount += 1;
      logMyOsFetchError(
        eventResult,
        logs,
        { bootstrapSessionId, eventId },
        fetchEventMessages
      );
      continue;
    }

    const processingResult = await handlePayNoteBootstrapWebhookEvent(
      {
        eventId,
        payload: eventResult.payload,
        skipEventIdempotencyClaim: true,
        skipPendingBuffer: true,
      },
      deps
    );
    logs.push(...processingResult.logs);

    if (processingResult.note === 'Deferred waiting for bootstrap context') {
      remainingCount += 1;
      continue;
    }

    await deps.pendingBootstrapEventRepository.deletePending({
      bootstrapSessionId,
      eventId,
    });
    consumedCount += 1;
    trace(logs, 'Consumed pending bootstrap event', {
      bootstrapSessionId,
      eventId,
    });
  }

  return { handled: true, consumedCount, remainingCount, logs };
};
