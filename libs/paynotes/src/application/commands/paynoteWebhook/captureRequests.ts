import type { CardTransactionDetails, Hold } from '@demo-bank-app/banking';
import type { LogEntry, MyOsClient, PayNoteRecord } from '../../ports';
import type {
  HandleWebhookEventDependencies,
  WebhookEmittedEvent,
  WebhookEventObject,
} from './types';
import {
  CAPTURE_LOCK_REQUESTED_EVENT_NAME,
  CAPTURE_UNLOCK_REQUESTED_EVENT_NAME,
  resolveEmittedEventType,
} from './events';
import { trace } from './logging';
import { upsertPayNoteContract } from './records';
import { getRecordString, toSimpleRecord } from './utils';

type PartialCardTransactionDetails = Partial<CardTransactionDetails>;

type CaptureRequestContext = {
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  updatedRecord: PayNoteRecord;
  eventObject?: WebhookEventObject;
  emittedEvents?: WebhookEmittedEvent[];
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>> | null;
};

const extractCardTransactionDetails = (
  value: unknown
): PartialCardTransactionDetails | undefined => {
  const record = toSimpleRecord(value);
  if (!record) {
    return undefined;
  }

  const details: PartialCardTransactionDetails = {
    retrievalReferenceNumber: getRecordString(
      record,
      'retrievalReferenceNumber'
    ),
    systemTraceAuditNumber: getRecordString(record, 'systemTraceAuditNumber'),
    transmissionDateTime: getRecordString(record, 'transmissionDateTime'),
    authorizationCode: getRecordString(record, 'authorizationCode'),
  };

  if (
    !details.retrievalReferenceNumber &&
    !details.systemTraceAuditNumber &&
    !details.transmissionDateTime &&
    !details.authorizationCode
  ) {
    return undefined;
  }

  return details;
};

const toCompleteCardTransactionDetails = (
  details: PartialCardTransactionDetails | undefined
): CardTransactionDetails | null => {
  if (!details) {
    return null;
  }

  const {
    retrievalReferenceNumber,
    systemTraceAuditNumber,
    transmissionDateTime,
    authorizationCode,
  } = details;

  if (
    !retrievalReferenceNumber ||
    !systemTraceAuditNumber ||
    !transmissionDateTime ||
    !authorizationCode
  ) {
    return null;
  }

  return {
    retrievalReferenceNumber,
    systemTraceAuditNumber,
    transmissionDateTime,
    authorizationCode,
  };
};

const matchesCardTransactionDetails = (
  holdDetails: CardTransactionDetails | undefined,
  provided: PartialCardTransactionDetails | undefined
): boolean => {
  if (!provided) {
    return true;
  }
  if (!holdDetails) {
    return false;
  }

  if (
    provided.retrievalReferenceNumber &&
    provided.retrievalReferenceNumber !== holdDetails.retrievalReferenceNumber
  ) {
    return false;
  }
  if (
    provided.systemTraceAuditNumber &&
    provided.systemTraceAuditNumber !== holdDetails.systemTraceAuditNumber
  ) {
    return false;
  }
  if (
    provided.transmissionDateTime &&
    provided.transmissionDateTime !== holdDetails.transmissionDateTime
  ) {
    return false;
  }
  if (
    provided.authorizationCode &&
    provided.authorizationCode !== holdDetails.authorizationCode
  ) {
    return false;
  }

  return true;
};

const resolveCaptureHold = async (input: {
  expectedHoldId?: string;
  providedCardDetails?: PartialCardTransactionDetails;
  completeCardDetails: CardTransactionDetails | null;
  eventId: string;
  payNoteDocumentId: string;
  eventType: string;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<{ hold: Hold; holdId: string; shouldLinkHold: boolean } | null> => {
  const {
    expectedHoldId,
    providedCardDetails,
    completeCardDetails,
    eventId,
    payNoteDocumentId,
    eventType,
    deps,
    logs,
  } = input;

  const linkedHold = expectedHoldId
    ? await deps.holdRepository.getHold(expectedHoldId)
    : null;

  const lookupHold = completeCardDetails
    ? await deps.holdRepository.getHoldByCardTransactionDetails(
        completeCardDetails
      )
    : null;

  if (expectedHoldId && lookupHold && lookupHold.holdId !== expectedHoldId) {
    logs.push({
      level: 'warn',
      message:
        'PayNote capture request ignored (card transaction hold mismatch)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType,
        expectedHoldId,
        resolvedHoldId: lookupHold.holdId,
      },
    });
    return null;
  }

  const holdId = expectedHoldId ?? lookupHold?.holdId;
  const hold: Hold | null = linkedHold ?? lookupHold ?? null;

  if (!hold || !holdId) {
    logs.push({
      level: 'warn',
      message:
        'PayNote capture request ignored (unable to resolve related hold)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType,
        holdId,
      },
    });
    return null;
  }

  if (
    providedCardDetails &&
    hold.cardTransactionDetails &&
    !matchesCardTransactionDetails(
      hold.cardTransactionDetails,
      providedCardDetails
    )
  ) {
    logs.push({
      level: 'warn',
      message:
        'PayNote capture request ignored (card transaction details mismatch)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType,
        holdId,
        providedCardTransactionDetails: providedCardDetails,
        holdCardTransactionDetails: hold.cardTransactionDetails,
      },
    });
    return null;
  }

  if (providedCardDetails && !hold.cardTransactionDetails) {
    logs.push({
      level: 'warn',
      message:
        'PayNote capture request hold missing card transaction details (continuing with hold linkage)',
      context: {
        eventId,
        payNoteDocumentId,
        eventType,
        holdId,
        providedCardTransactionDetails: providedCardDetails,
      },
    });
  }

  return { hold, holdId, shouldLinkHold: !expectedHoldId };
};

const linkPayNoteHold = async (input: {
  updatedRecord: PayNoteRecord;
  holdId: string;
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  eventType: string;
  eventObject?: WebhookEventObject;
  emittedEvents?: WebhookEmittedEvent[];
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const {
    updatedRecord,
    holdId,
    eventId,
    payNoteDocumentId,
    sessionId,
    eventType,
    eventObject,
    emittedEvents,
    deps,
    logs,
  } = input;

  updatedRecord.holdId = holdId;
  const updatedAt = deps.clock.now().toISOString();
  updatedRecord.updatedAt = updatedAt;

  await deps.payNoteRepository.savePayNote({
    ...updatedRecord,
    updatedAt,
  });

  await upsertPayNoteContract({
    updatedRecord,
    sessionId,
    payNoteDocumentId,
    eventType,
    triggerEvent: eventObject?.triggeredBy,
    emittedEvents,
    relatedHoldIds: [holdId],
    now: updatedAt,
    deps,
  });

  trace(logs, 'Linked PayNote hold after capture request', {
    eventId,
    payNoteDocumentId,
    holdId,
  });
};

const applyCaptureLock = async (input: {
  holdId: string;
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>> | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const {
    holdId,
    eventId,
    payNoteDocumentId,
    sessionId,
    credentials,
    deps,
    logs,
  } = input;

  const updatedHold = await deps.holdRepository.disableHoldCapture(holdId);
  if (!updatedHold) {
    logs.push({
      level: 'warn',
      message:
        'PayNote capture lock request ignored (hold not found while applying lock)',
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
      },
    });
    return;
  }

  if (updatedHold.status !== 'PENDING' || !updatedHold.captureDisabled) {
    logs.push({
      level: 'warn',
      message:
        'PayNote capture lock request ignored (hold capture could not be locked)',
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
        holdStatus: updatedHold.status,
        captureDisabled: updatedHold.captureDisabled ?? false,
      },
    });
    return;
  }

  if (!credentials) {
    logs.push({
      level: 'error',
      message:
        'Skipped confirming PayNote card transaction capture locked (missing MyOS credentials)',
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
      },
    });
    return;
  }

  const response = await deps.myOsClient.runDocumentOperation({
    credentials,
    sessionId,
    operation: 'confirmCardTransactionCaptureLocked',
  });

  if (!response.ok) {
    logs.push({
      level: 'error',
      message: 'Failed to confirm PayNote card transaction capture locked',
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
        status: response.status,
        body: response.body,
      },
    });
    return;
  }

  logs.push({
    level: 'info',
    message: 'Confirmed PayNote card transaction capture locked',
    context: {
      eventId,
      payNoteDocumentId,
      holdId,
    },
  });
};

const applyCaptureUnlock = async (input: {
  holdId: string;
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>> | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const {
    holdId,
    eventId,
    payNoteDocumentId,
    sessionId,
    credentials,
    deps,
    logs,
  } = input;

  const updatedHold = await deps.holdRepository.enableHoldCapture(holdId);
  if (!updatedHold) {
    logs.push({
      level: 'warn',
      message:
        'PayNote capture unlock request ignored (hold not found while applying unlock)',
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
      },
    });
    return;
  }

  if (updatedHold.status !== 'PENDING' || updatedHold.captureDisabled) {
    logs.push({
      level: 'warn',
      message:
        'PayNote capture unlock request ignored (hold capture could not be unlocked)',
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
        holdStatus: updatedHold.status,
        captureDisabled: updatedHold.captureDisabled ?? false,
      },
    });
    return;
  }

  if (!credentials) {
    logs.push({
      level: 'error',
      message:
        'Skipped confirming PayNote card transaction capture unlocked (missing MyOS credentials)',
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
      },
    });
    return;
  }

  const response = await deps.myOsClient.runDocumentOperation({
    credentials,
    sessionId,
    operation: 'confirmCardTransactionCaptureUnlocked',
  });

  if (!response.ok) {
    logs.push({
      level: 'error',
      message: 'Failed to confirm PayNote card transaction capture unlocked',
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
        status: response.status,
        body: response.body,
      },
    });
    return;
  }

  logs.push({
    level: 'info',
    message: 'Confirmed PayNote card transaction capture unlocked',
    context: {
      eventId,
      payNoteDocumentId,
      holdId,
    },
  });
};

const isCaptureRequestEvent = (event: WebhookEmittedEvent): boolean => {
  const eventType = resolveEmittedEventType(event);
  return (
    eventType === CAPTURE_LOCK_REQUESTED_EVENT_NAME ||
    eventType === CAPTURE_UNLOCK_REQUESTED_EVENT_NAME
  );
};

const resolveCaptureRequestCredentials = async (
  deps: HandleWebhookEventDependencies,
  logs: LogEntry[],
  eventId: string,
  payNoteDocumentId: string
): Promise<Awaited<ReturnType<MyOsClient['getCredentials']>> | null> => {
  try {
    return await deps.myOsClient.getCredentials();
  } catch (error) {
    logs.push({
      level: 'error',
      message: 'Failed to resolve MyOS credentials for PayNote capture request',
      context: {
        eventId,
        payNoteDocumentId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
};

const handleCaptureRequestEvent = async (
  context: CaptureRequestContext,
  event: WebhookEmittedEvent
): Promise<void> => {
  const {
    eventId,
    payNoteDocumentId,
    sessionId,
    updatedRecord,
    eventObject,
    emittedEvents,
    deps,
    logs,
    credentials,
  } = context;

  const eventType = resolveEmittedEventType(event);
  if (
    eventType !== CAPTURE_LOCK_REQUESTED_EVENT_NAME &&
    eventType !== CAPTURE_UNLOCK_REQUESTED_EVENT_NAME
  ) {
    return;
  }

  const providedCardDetails = extractCardTransactionDetails(
    (event as { cardTransactionDetails?: unknown }).cardTransactionDetails
  );
  const completeCardDetails =
    toCompleteCardTransactionDetails(providedCardDetails);

  const expectedHoldId = updatedRecord.holdId;
  const captureHold = await resolveCaptureHold({
    expectedHoldId,
    providedCardDetails,
    completeCardDetails,
    eventId,
    payNoteDocumentId,
    eventType,
    deps,
    logs,
  });

  if (!captureHold) {
    return;
  }

  if (captureHold.shouldLinkHold) {
    await linkPayNoteHold({
      updatedRecord,
      holdId: captureHold.holdId,
      eventId,
      payNoteDocumentId,
      sessionId,
      eventType,
      eventObject,
      emittedEvents,
      deps,
      logs,
    });
  }

  if (eventType === CAPTURE_LOCK_REQUESTED_EVENT_NAME) {
    await applyCaptureLock({
      holdId: captureHold.holdId,
      eventId,
      payNoteDocumentId,
      sessionId,
      credentials,
      deps,
      logs,
    });
    return;
  }

  await applyCaptureUnlock({
    holdId: captureHold.holdId,
    eventId,
    payNoteDocumentId,
    sessionId,
    credentials,
    deps,
    logs,
  });
};

export const handleCaptureRequestEvents = async (input: {
  events: WebhookEmittedEvent[];
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  updatedRecord: PayNoteRecord;
  eventObject?: WebhookEventObject;
  emittedEvents?: WebhookEmittedEvent[];
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const {
    events,
    eventId,
    payNoteDocumentId,
    sessionId,
    updatedRecord,
    eventObject,
    emittedEvents,
    deps,
    logs,
  } = input;

  const captureRequestEvents = events.filter(isCaptureRequestEvent);

  if (!captureRequestEvents.length) {
    return;
  }

  const credentials = await resolveCaptureRequestCredentials(
    deps,
    logs,
    eventId,
    payNoteDocumentId
  );

  const context: CaptureRequestContext = {
    eventId,
    payNoteDocumentId,
    sessionId,
    updatedRecord,
    eventObject,
    emittedEvents,
    deps,
    logs,
    credentials,
  };

  for (const event of captureRequestEvents) {
    try {
      await handleCaptureRequestEvent(context, event);
    } catch (error) {
      logs.push({
        level: 'error',
        message: 'Unexpected error while handling PayNote capture request',
        context: {
          eventId,
          payNoteDocumentId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
};
