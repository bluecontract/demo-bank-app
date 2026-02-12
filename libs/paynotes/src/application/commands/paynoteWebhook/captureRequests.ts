import type { CardTransactionDetails, Hold } from '@demo-bank-app/banking';
import type { LogEntry, MyOsClient, PayNoteRecord } from '../../ports';
import type {
  HandleWebhookEventDependencies,
  WebhookEmittedEvent,
  WebhookEventObject,
} from './types';
import { runGuarantorUpdate } from '../documentOperations';
import { blue } from '../../../blue';
import {
  CAPTURE_LOCK_REQUESTED_EVENT_NAME,
  CAPTURE_UNLOCK_REQUESTED_EVENT_NAME,
  resolveCaptureRequestId,
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

const resolveCaptureEventId = (
  event: WebhookEmittedEvent
): string | undefined => {
  try {
    const node = blue.jsonValueToNode(event);
    if (!node) {
      return undefined;
    }
    return blue.calculateBlueIdSync(node);
  } catch {
    return undefined;
  }
};

const persistCaptureEventId = async (input: {
  updatedRecord: PayNoteRecord;
  captureEventId: string;
  eventType: 'lock' | 'unlock';
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
  payNoteDocumentId: string;
  eventId: string;
}) => {
  const { updatedRecord, captureEventId, eventType, deps, logs } = input;
  const updatedAt = deps.clock.now().toISOString();
  if (eventType === 'lock') {
    updatedRecord.lastCaptureLockEventId = captureEventId;
  } else {
    updatedRecord.lastCaptureUnlockEventId = captureEventId;
  }
  updatedRecord.updatedAt = updatedAt;

  await deps.payNoteRepository.savePayNote({
    ...updatedRecord,
    updatedAt,
  });

  trace(logs, 'Recorded PayNote capture request id', {
    eventId: input.eventId,
    payNoteDocumentId: input.payNoteDocumentId,
    captureEventId,
    eventType,
  });
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
    deliveryRecord: null,
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

const CAPTURE_LOCKED_EVENT_NAME = 'PayNote/Card Transaction Capture Locked';
const CAPTURE_UNLOCKED_EVENT_NAME = 'PayNote/Card Transaction Capture Unlocked';

const confirmCaptureStatusChange = async (input: {
  holdId: string;
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  requestId?: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>> | null;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
  eventType: 'lock' | 'unlock';
}): Promise<boolean> => {
  const {
    holdId,
    eventId,
    payNoteDocumentId,
    sessionId,
    requestId,
    credentials,
    deps,
    logs,
    eventType,
  } = input;

  const isLock = eventType === 'lock';
  const eventName = isLock
    ? CAPTURE_LOCKED_EVENT_NAME
    : CAPTURE_UNLOCKED_EVENT_NAME;

  const payload: Record<string, unknown> = isLock
    ? {
        type: eventName,
        lockedAt: deps.clock.now().toISOString(),
      }
    : {
        type: eventName,
        unlockedAt: deps.clock.now().toISOString(),
      };
  if (requestId) {
    payload.inResponseTo = {
      requestId,
    };
  }

  return runGuarantorUpdate({
    myOsClient: deps.myOsClient,
    sessionId,
    credentials,
    logs,
    logContext: {
      eventId,
      payNoteDocumentId,
      holdId,
    },
    request: [payload],
    successMessage: `Reported PayNote card transaction capture ${
      isLock ? 'locked' : 'unlocked'
    } via guarantorUpdate`,
    failureMessage: `Failed to report PayNote card transaction capture ${
      isLock ? 'locked' : 'unlocked'
    } via guarantorUpdate`,
    missingCredentialsMessage: `Skipped PayNote card transaction capture ${
      isLock ? 'lock' : 'unlock'
    } update (missing MyOS credentials)`,
  });
};

const updateHoldCaptureStatus = async (input: {
  holdId: string;
  eventId: string;
  payNoteDocumentId: string;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
  eventType: 'lock' | 'unlock';
}): Promise<boolean> => {
  const { holdId, eventId, payNoteDocumentId, deps, logs, eventType } = input;
  const isLock = eventType === 'lock';

  const updatedHold = isLock
    ? await deps.holdRepository.disableHoldCapture(holdId)
    : await deps.holdRepository.enableHoldCapture(holdId);

  if (!updatedHold) {
    logs.push({
      level: 'warn',
      message: `PayNote capture ${
        isLock ? 'lock' : 'unlock'
      } request ignored (hold not found while applying ${
        isLock ? 'lock' : 'unlock'
      })`,
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
      },
    });
    return false;
  }

  const success = isLock
    ? updatedHold.captureDisabled
    : !updatedHold.captureDisabled;

  if (updatedHold.status !== 'PENDING' || !success) {
    logs.push({
      level: 'warn',
      message: `PayNote capture ${
        isLock ? 'lock' : 'unlock'
      } request ignored (hold capture could not be ${
        isLock ? 'locked' : 'unlocked'
      })`,
      context: {
        eventId,
        payNoteDocumentId,
        holdId,
        holdStatus: updatedHold.status,
        captureDisabled: updatedHold.captureDisabled ?? false,
      },
    });
    return false;
  }

  return true;
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

  const eventName = resolveEmittedEventType(event);
  if (
    eventName !== CAPTURE_LOCK_REQUESTED_EVENT_NAME &&
    eventName !== CAPTURE_UNLOCK_REQUESTED_EVENT_NAME
  ) {
    return;
  }

  const isLock = eventName === CAPTURE_LOCK_REQUESTED_EVENT_NAME;
  const requestId = resolveCaptureRequestId(event);
  const captureEventId = resolveCaptureEventId(event) ?? eventId;
  const lastCaptureEventId = isLock
    ? updatedRecord.lastCaptureLockEventId
    : updatedRecord.lastCaptureUnlockEventId;

  if (captureEventId && lastCaptureEventId === captureEventId) {
    trace(logs, 'Skipped duplicate PayNote capture request', {
      eventId,
      payNoteDocumentId,
      captureEventId,
      eventName,
    });
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
    eventType: eventName,
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
      eventType: eventName,
      eventObject,
      emittedEvents,
      deps,
      logs,
    });
  }

  const captureDisabled = captureHold.hold.captureDisabled ?? false;
  const alreadyInState = isLock ? captureDisabled : !captureDisabled;

  if (alreadyInState) {
    trace(
      logs,
      `PayNote capture already ${
        isLock ? 'locked' : 'unlocked'
      } locally; confirming in MyOS`,
      {
        eventId,
        payNoteDocumentId,
        holdId: captureHold.holdId,
        captureEventId,
      }
    );
  } else {
    const updated = await updateHoldCaptureStatus({
      holdId: captureHold.holdId,
      eventId,
      payNoteDocumentId,
      deps,
      logs,
      eventType: isLock ? 'lock' : 'unlock',
    });
    if (!updated) {
      return;
    }
  }

  const confirmed = await confirmCaptureStatusChange({
    holdId: captureHold.holdId,
    eventId,
    payNoteDocumentId,
    sessionId,
    requestId,
    credentials,
    deps,
    logs,
    eventType: isLock ? 'lock' : 'unlock',
  });

  if (confirmed && captureEventId) {
    await persistCaptureEventId({
      updatedRecord,
      captureEventId,
      eventType: isLock ? 'lock' : 'unlock',
      deps,
      logs,
      payNoteDocumentId,
      eventId,
    });
  }
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
