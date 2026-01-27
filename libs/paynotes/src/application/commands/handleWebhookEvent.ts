import type { BlueNode } from '@blue-labs/language';
import {
  CardTransactionCaptureLockRequestedSchema,
  CardTransactionCaptureUnlockRequestedSchema,
  CaptureFundsRequestedSchema,
  PayNoteSchema,
  ReserveFundsAndCaptureImmediatelyRequestedSchema,
  ReserveFundsRequestedSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import type {
  CardTransactionDetails,
  Hold,
  HoldRepository,
} from '@demo-bank-app/banking';
import type {
  BankingFacade,
  ClockPort,
  LogEntry,
  MyOsClient,
  MyOsFetchDocumentResult,
  MyOsFetchEventResult,
  PayNoteDeliveryRepository,
  PayNoteRecord,
  PayNoteRepository,
} from '../ports';
import type { ContractRepository } from '@demo-bank-app/contracts';
import { blue } from '../../blue';
import { upsertContractRecord } from '../contracts';

const RESERVE_FUNDS_EVENT_NAME = 'PayNote/Reserve Funds Requested';
const CAPTURE_FUNDS_EVENT_NAME = 'PayNote/Capture Funds Requested';
const CAPTURE_IMMEDIATELY_EVENT_NAME =
  'PayNote/Reserve Funds and Capture Immediately Requested';
const CAPTURE_LOCK_REQUESTED_EVENT_NAME =
  'PayNote/Card Transaction Capture Lock Requested';
const CAPTURE_UNLOCK_REQUESTED_EVENT_NAME =
  'PayNote/Card Transaction Capture Unlock Requested';

const isTraceEnabled =
  process.env.PAYNOTE_WEBHOOK_TRACE === '1' ||
  (process.env.LOG_LEVEL ?? '').toUpperCase() === 'DEBUG';

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

const toBlueNode = (value: unknown): BlueNode | null => {
  if (!value) {
    return null;
  }
  try {
    return blue.jsonValueToNode(value);
  } catch {
    return null;
  }
};

const parsePayNoteDocument = (value: unknown) => {
  const node = toBlueNode(value);
  if (
    !node ||
    !blue.isTypeOf(node, PayNoteSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return null;
  }
  return {
    node,
    output: blue.nodeToSchemaOutput(node, PayNoteSchema),
  };
};

const getString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const unwrapNodeValue = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  return 'value' in record ? record.value : value;
};

const getUnwrappedString = (value: unknown): string | undefined => {
  const unwrapped = unwrapNodeValue(value);
  return getString(unwrapped);
};

const getRecordString = (
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  return record ? getString(record[key]) : undefined;
};

type PartialCardTransactionDetails = Partial<CardTransactionDetails>;

const extractCardTransactionDetails = (
  value: unknown
): PartialCardTransactionDetails | undefined => {
  const unwrapped = unwrapNodeValue(value);
  if (!unwrapped || typeof unwrapped !== 'object') {
    return undefined;
  }

  const record = unwrapped as Record<string, unknown>;
  const details: PartialCardTransactionDetails = {
    retrievalReferenceNumber: getUnwrappedString(
      record.retrievalReferenceNumber
    ),
    systemTraceAuditNumber: getUnwrappedString(record.systemTraceAuditNumber),
    transmissionDateTime: getUnwrappedString(record.transmissionDateTime),
    authorizationCode: getUnwrappedString(record.authorizationCode),
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

const mergeSessionIds = (
  existing: string[] | undefined,
  next: string | undefined
): string[] | undefined => {
  if (!next) {
    return existing;
  }
  const set = new Set(existing ?? []);
  set.add(next);
  return Array.from(set);
};

export interface HandleWebhookEventInput {
  eventId: string;
  eventPayload?: unknown;
}

export interface HandleWebhookEventDependencies {
  myOsClient: MyOsClient;
  bankingFacade: BankingFacade;
  holdRepository: HoldRepository;
  payNoteRepository: PayNoteRepository;
  payNoteDeliveryRepository: PayNoteDeliveryRepository;
  contractRepository: ContractRepository;
  clock: ClockPort;
}

export interface HandleWebhookEventResult {
  note?: string;
  logs: LogEntry[];
}

const logAndReturn = (
  logs: LogEntry[],
  level: LogEntry['level'],
  message: string,
  context?: Record<string, unknown>
) => {
  logs.push({ level, message, context });
  return message;
};

const trace = (
  logs: LogEntry[],
  message: string,
  context?: Record<string, unknown>
) => {
  if (!isTraceEnabled) {
    return;
  }
  logs.push({ level: 'info', message, context });
};

const mapFetchEventError = (
  result: MyOsFetchEventResult,
  eventId: string,
  logs: LogEntry[]
): HandleWebhookEventResult => {
  switch (result.kind) {
    case 'not-found': {
      const note = logAndReturn(
        logs,
        'error',
        'Failed to download PayNote event from MyOS',
        {
          eventId,
          status: result.status,
        }
      );
      return { note, logs };
    }
    case 'http-error': {
      const note = logAndReturn(
        logs,
        'error',
        'Failed to download PayNote event from MyOS',
        {
          eventId,
          status: result.status,
          statusText: result.statusText,
        }
      );
      return { note, logs };
    }
    case 'parse-error': {
      const note = logAndReturn(
        logs,
        'error',
        'Failed to parse PayNote event payload',
        {
          eventId,
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        }
      );
      return { note, logs };
    }
    case 'network-error': {
      const note = logAndReturn(
        logs,
        'error',
        'Unexpected error while downloading PayNote event',
        {
          eventId,
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        }
      );
      return { note, logs };
    }
    default:
      return { note: undefined, logs };
  }
};

const mapFetchDocumentError = (
  result: MyOsFetchDocumentResult,
  sessionId: string,
  logs: LogEntry[]
): void => {
  switch (result.kind) {
    case 'not-found':
      logs.push({
        level: 'error',
        message: 'Failed to resolve PayNote document from MyOS',
        context: { sessionId, status: result.status },
      });
      return;
    case 'http-error':
      logs.push({
        level: 'error',
        message: 'Failed to resolve PayNote document from MyOS',
        context: {
          sessionId,
          status: result.status,
          statusText: result.statusText,
        },
      });
      return;
    case 'parse-error':
      logs.push({
        level: 'error',
        message: 'Failed to parse PayNote document response from MyOS',
        context: {
          sessionId,
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        },
      });
      return;
    case 'network-error':
      logs.push({
        level: 'error',
        message: 'Unexpected error while resolving PayNote document',
        context: {
          sessionId,
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        },
      });
      return;
    default:
      return;
  }
};

export const handleWebhookEvent = async (
  input: HandleWebhookEventInput,
  deps: HandleWebhookEventDependencies
): Promise<HandleWebhookEventResult> => {
  const logs: LogEntry[] = [];
  trace(logs, 'PayNote webhook processing', {
    eventId: input.eventId,
    hasPayload: Boolean(input.eventPayload),
  });

  const resolvedPayload = input.eventPayload;
  if (!resolvedPayload) {
    const eventResult = await deps.myOsClient.fetchEvent(input.eventId);
    if (eventResult.kind !== 'success') {
      return mapFetchEventError(eventResult, input.eventId, logs);
    }
    trace(logs, 'Fetched PayNote event payload from MyOS', {
      eventId: input.eventId,
    });
    return handleWebhookEvent(
      { eventId: input.eventId, eventPayload: eventResult.payload },
      deps
    );
  }

  const eventPayload = resolvedPayload as {
    type?: string;
    object?: {
      sessionId?: string;
      document?: Record<string, unknown>;
      emitted?: Array<{
        type?: { name?: string };
        amount?: { value?: number };
      }>;
      triggeredBy?: unknown;
    };
  };

  const eventObject = eventPayload?.object;
  const eventType = eventPayload?.type;
  const document = eventObject?.document;
  const emittedEvents = Array.isArray(eventObject?.emitted)
    ? eventObject?.emitted
    : undefined;

  if (!document) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote event missing document payload',
      { eventId: input.eventId }
    );
    return { note, logs };
  }

  const sessionId =
    typeof eventObject?.sessionId === 'string'
      ? eventObject.sessionId
      : undefined;

  if (!sessionId) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote event missing session id',
      { eventId: input.eventId }
    );
    return { note, logs };
  }

  trace(logs, 'Resolved PayNote session id', {
    eventId: input.eventId,
    sessionId,
  });

  const payNoteRecord = await deps.payNoteRepository.getPayNoteBySessionId(
    sessionId
  );
  let payNoteDocumentId = payNoteRecord?.payNoteDocumentId;
  let resolvedDocument: Record<string, unknown> | undefined;

  if (!payNoteDocumentId) {
    const documentResult = await deps.myOsClient.fetchDocument(sessionId);
    if (documentResult.kind !== 'success') {
      mapFetchDocumentError(documentResult, sessionId, logs);
      return { note: 'Failed to resolve PayNote document id', logs };
    }

    payNoteDocumentId = documentResult.document.documentId;
    resolvedDocument = documentResult.document.document;
    trace(logs, 'Resolved PayNote document id from MyOS', {
      eventId: input.eventId,
      sessionId,
      payNoteDocumentId,
    });
  }

  if (!payNoteDocumentId) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote document id missing after resolution',
      { eventId: input.eventId, sessionId }
    );
    return { note, logs };
  }

  const now = deps.clock.now().toISOString();
  const existingRecord =
    payNoteRecord ??
    (await deps.payNoteRepository.getPayNote(payNoteDocumentId));

  const deliveryRecord =
    existingRecord?.deliveryId != null
      ? await deps.payNoteDeliveryRepository.getDelivery(
          existingRecord.deliveryId
        )
      : await deps.payNoteDeliveryRepository.getDeliveryByPayNoteDocumentId(
          payNoteDocumentId
        );

  trace(logs, 'Resolved PayNote delivery linkage', {
    eventId: input.eventId,
    payNoteDocumentId,
    hasPayNoteRecord: Boolean(existingRecord),
    deliveryId: deliveryRecord?.deliveryId ?? null,
  });

  const payNoteParsed =
    parsePayNoteDocument(document) ??
    (resolvedDocument ? parsePayNoteDocument(resolvedDocument) : null);
  if (!payNoteParsed) {
    const note = logAndReturn(
      logs,
      'error',
      'PayNote webhook document is not a PayNote',
      { eventId: input.eventId, sessionId }
    );
    return { note, logs };
  }

  const payNoteSimple = blue.nodeToJson(payNoteParsed.node, 'simple') as
    | Record<string, unknown>
    | undefined;
  const payerAccountNumber =
    existingRecord?.payerAccountNumber ??
    deliveryRecord?.accountNumber ??
    getRecordString(payNoteSimple, 'payerAccountNumber');
  const payeeAccountNumber =
    existingRecord?.payeeAccountNumber ??
    getRecordString(payNoteSimple, 'payeeAccountNumber');

  const updatedRecord: PayNoteRecord = {
    payNoteDocumentId,
    sessionIds: mergeSessionIds(existingRecord?.sessionIds, sessionId),
    deliveryId: existingRecord?.deliveryId ?? deliveryRecord?.deliveryId,
    accountNumber:
      existingRecord?.accountNumber ??
      deliveryRecord?.accountNumber ??
      payerAccountNumber,
    userId: existingRecord?.userId ?? deliveryRecord?.userId,
    holdId: existingRecord?.holdId ?? deliveryRecord?.holdId,
    transactionId:
      existingRecord?.transactionId ?? deliveryRecord?.transactionId,
    payerAccountNumber,
    payeeAccountNumber,
    document: document ?? resolvedDocument ?? existingRecord?.document,
    transactionRequest:
      eventObject?.emitted ?? existingRecord?.transactionRequest ?? null,
    triggerEvent:
      eventObject?.triggeredBy ?? existingRecord?.triggerEvent ?? null,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
  };

  await deps.payNoteRepository.savePayNote(updatedRecord);
  await upsertContractRecord({
    contractRepository: deps.contractRepository,
    document: updatedRecord.document,
    sessionId,
    documentId: payNoteDocumentId,
    eventType,
    userId: updatedRecord.userId,
    accountNumber: updatedRecord.accountNumber,
    triggerEvent: eventObject?.triggeredBy,
    emittedEvents,
    relatedTransactionIds: updatedRecord.transactionId
      ? [updatedRecord.transactionId]
      : undefined,
    relatedHoldIds: updatedRecord.holdId ? [updatedRecord.holdId] : undefined,
    status: updatedRecord.transactionId
      ? 'processed'
      : updatedRecord.holdId
      ? 'reserved'
      : undefined,
    now,
  });

  const events =
    eventObject?.emitted ??
    ([] as Array<{ type?: unknown; amount?: { value?: number } }>);

  logs.push({
    level: 'info',
    message: 'Received PayNote webhook',
    context: {
      eventId: input.eventId,
      events,
      payNoteDocumentId,
      payerAccountNumber,
      payeeAccountNumber,
    },
  });

  const captureRequestEvents = events.filter(event => {
    const eventType = resolveEventType(event) ?? resolveEventTypeLabel(event);
    return (
      eventType === CAPTURE_LOCK_REQUESTED_EVENT_NAME ||
      eventType === CAPTURE_UNLOCK_REQUESTED_EVENT_NAME
    );
  });

  if (captureRequestEvents.length) {
    let credentials: Awaited<ReturnType<MyOsClient['getCredentials']>> | null =
      null;

    try {
      credentials = await deps.myOsClient.getCredentials();
    } catch (error) {
      logs.push({
        level: 'error',
        message:
          'Failed to resolve MyOS credentials for PayNote capture request',
        context: {
          eventId: input.eventId,
          payNoteDocumentId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }

    for (const event of captureRequestEvents) {
      try {
        const eventType =
          resolveEventType(event) ?? resolveEventTypeLabel(event);
        if (
          eventType !== CAPTURE_LOCK_REQUESTED_EVENT_NAME &&
          eventType !== CAPTURE_UNLOCK_REQUESTED_EVENT_NAME
        ) {
          continue;
        }

        const providedCardDetails = extractCardTransactionDetails(
          (event as { cardTransactionDetails?: unknown }).cardTransactionDetails
        );
        const completeCardDetails =
          toCompleteCardTransactionDetails(providedCardDetails);

        const expectedHoldId = updatedRecord.holdId;
        const linkedHold = expectedHoldId
          ? await deps.holdRepository.getHold(expectedHoldId)
          : null;

        const lookupHold = completeCardDetails
          ? await deps.holdRepository.getHoldByCardTransactionDetails(
              completeCardDetails
            )
          : null;

        if (
          expectedHoldId &&
          lookupHold &&
          lookupHold.holdId !== expectedHoldId
        ) {
          logs.push({
            level: 'warn',
            message:
              'PayNote capture request ignored (card transaction hold mismatch)',
            context: {
              eventId: input.eventId,
              payNoteDocumentId,
              eventType,
              expectedHoldId,
              resolvedHoldId: lookupHold.holdId,
            },
          });
          continue;
        }

        const holdId = expectedHoldId ?? lookupHold?.holdId;
        const hold: Hold | null = linkedHold ?? lookupHold ?? null;

        if (!hold || !holdId) {
          logs.push({
            level: 'warn',
            message:
              'PayNote capture request ignored (unable to resolve related hold)',
            context: {
              eventId: input.eventId,
              payNoteDocumentId,
              eventType,
              holdId,
            },
          });
          continue;
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
              eventId: input.eventId,
              payNoteDocumentId,
              eventType,
              holdId,
              providedCardTransactionDetails: providedCardDetails,
              holdCardTransactionDetails: hold.cardTransactionDetails,
            },
          });
          continue;
        }

        if (providedCardDetails && !hold.cardTransactionDetails) {
          logs.push({
            level: 'warn',
            message:
              'PayNote capture request hold missing card transaction details (continuing with hold linkage)',
            context: {
              eventId: input.eventId,
              payNoteDocumentId,
              eventType,
              holdId,
              providedCardTransactionDetails: providedCardDetails,
            },
          });
        }

        if (!expectedHoldId) {
          updatedRecord.holdId = holdId;
          const updatedAt = deps.clock.now().toISOString();
          updatedRecord.updatedAt = updatedAt;
          await deps.payNoteRepository.savePayNote({
            ...updatedRecord,
            updatedAt,
          });
          await upsertContractRecord({
            contractRepository: deps.contractRepository,
            document: updatedRecord.document,
            sessionId,
            documentId: payNoteDocumentId,
            eventType,
            userId: updatedRecord.userId,
            accountNumber: updatedRecord.accountNumber,
            triggerEvent: eventObject?.triggeredBy,
            emittedEvents,
            relatedTransactionIds: updatedRecord.transactionId
              ? [updatedRecord.transactionId]
              : undefined,
            relatedHoldIds: [holdId],
            status: updatedRecord.transactionId ? 'processed' : 'reserved',
            now: updatedAt,
          });
        }

        if (eventType === CAPTURE_LOCK_REQUESTED_EVENT_NAME) {
          const updatedHold = await deps.holdRepository.disableHoldCapture(
            holdId
          );
          if (!updatedHold) {
            logs.push({
              level: 'warn',
              message:
                'PayNote capture lock request ignored (hold not found while applying lock)',
              context: {
                eventId: input.eventId,
                payNoteDocumentId,
                holdId,
              },
            });
            continue;
          }

          if (
            updatedHold.status !== 'PENDING' ||
            !updatedHold.captureDisabled
          ) {
            logs.push({
              level: 'warn',
              message:
                'PayNote capture lock request ignored (hold capture could not be locked)',
              context: {
                eventId: input.eventId,
                payNoteDocumentId,
                holdId,
                holdStatus: updatedHold.status,
                captureDisabled: updatedHold.captureDisabled ?? false,
              },
            });
            continue;
          }

          if (!credentials) {
            logs.push({
              level: 'error',
              message:
                'Skipped confirming PayNote card transaction capture locked (missing MyOS credentials)',
              context: {
                eventId: input.eventId,
                payNoteDocumentId,
                holdId,
              },
            });
            continue;
          }

          const response = await deps.myOsClient.runDocumentOperation({
            credentials,
            sessionId,
            operation: 'confirmCardTransactionCaptureLocked',
          });

          if (!response.ok) {
            logs.push({
              level: 'error',
              message:
                'Failed to confirm PayNote card transaction capture locked',
              context: {
                eventId: input.eventId,
                payNoteDocumentId,
                holdId,
                status: response.status,
                body: response.body,
              },
            });
            continue;
          }

          logs.push({
            level: 'info',
            message: 'Confirmed PayNote card transaction capture locked',
            context: {
              eventId: input.eventId,
              payNoteDocumentId,
              holdId,
            },
          });
        } else if (eventType === CAPTURE_UNLOCK_REQUESTED_EVENT_NAME) {
          const updatedHold = await deps.holdRepository.enableHoldCapture(
            holdId
          );
          if (!updatedHold) {
            logs.push({
              level: 'warn',
              message:
                'PayNote capture unlock request ignored (hold not found while applying unlock)',
              context: {
                eventId: input.eventId,
                payNoteDocumentId,
                holdId,
              },
            });
            continue;
          }

          if (updatedHold.status !== 'PENDING' || updatedHold.captureDisabled) {
            logs.push({
              level: 'warn',
              message:
                'PayNote capture unlock request ignored (hold capture could not be unlocked)',
              context: {
                eventId: input.eventId,
                payNoteDocumentId,
                holdId,
                holdStatus: updatedHold.status,
                captureDisabled: updatedHold.captureDisabled ?? false,
              },
            });
            continue;
          }

          if (!credentials) {
            logs.push({
              level: 'error',
              message:
                'Skipped confirming PayNote card transaction capture unlocked (missing MyOS credentials)',
              context: {
                eventId: input.eventId,
                payNoteDocumentId,
                holdId,
              },
            });
            continue;
          }

          const response = await deps.myOsClient.runDocumentOperation({
            credentials,
            sessionId,
            operation: 'confirmCardTransactionCaptureUnlocked',
          });

          if (!response.ok) {
            logs.push({
              level: 'error',
              message:
                'Failed to confirm PayNote card transaction capture unlocked',
              context: {
                eventId: input.eventId,
                payNoteDocumentId,
                holdId,
                status: response.status,
                body: response.body,
              },
            });
            continue;
          }

          logs.push({
            level: 'info',
            message: 'Confirmed PayNote card transaction capture unlocked',
            context: {
              eventId: input.eventId,
              payNoteDocumentId,
              holdId,
            },
          });
        }
      } catch (error) {
        logs.push({
          level: 'error',
          message: 'Unexpected error while handling PayNote capture request',
          context: {
            eventId: input.eventId,
            payNoteDocumentId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  const transferDescription =
    getString(payNoteParsed.output.name) ?? 'PayNote transfer';

  const requiresPayerAccount = events.some(event => {
    const eventType = resolveEventType(event) ?? resolveEventTypeLabel(event);
    return (
      eventType === CAPTURE_IMMEDIATELY_EVENT_NAME ||
      eventType === CAPTURE_FUNDS_EVENT_NAME ||
      eventType === RESERVE_FUNDS_EVENT_NAME
    );
  });

  if (!payerAccountNumber) {
    if (!requiresPayerAccount) {
      return { note: '', logs };
    }

    const note = logAndReturn(
      logs,
      'error',
      'PayNote event missing payer account mapping',
      {
        eventId: input.eventId,
        payNoteDocumentId,
      }
    );
    return { note, logs };
  }

  try {
    const account = await deps.bankingFacade.getAccountByNumber(
      payerAccountNumber
    );

    if (!account) {
      const note = logAndReturn(
        logs,
        'error',
        'Unable to resolve payer account ID from number for PayNote transfer',
        {
          eventId: input.eventId,
          payerAccountNumber,
        }
      );
      return { note, logs };
    }

    if (!account.ownerUserId) {
      const note = logAndReturn(
        logs,
        'error',
        'Unable to resolve payer account owner for PayNote transfer',
        {
          eventId: input.eventId,
          payerAccountId: account.id,
        }
      );
      return { note, logs };
    }

    if (!updatedRecord.userId || !updatedRecord.accountNumber) {
      updatedRecord.userId = account.ownerUserId;
      updatedRecord.accountNumber = account.accountNumber;
      await deps.payNoteRepository.savePayNote({
        ...updatedRecord,
        updatedAt: deps.clock.now().toISOString(),
      });
    }

    for (const event of events) {
      const transferAmountMinor: number = event.amount?.value ?? 0;
      const eventType = resolveEventType(event) ?? resolveEventTypeLabel(event);

      if (
        eventType === CAPTURE_LOCK_REQUESTED_EVENT_NAME ||
        eventType === CAPTURE_UNLOCK_REQUESTED_EVENT_NAME
      ) {
        continue;
      }

      if (eventType === CAPTURE_IMMEDIATELY_EVENT_NAME) {
        if (!payeeAccountNumber) {
          logs.push({
            level: 'warn',
            message: 'PayNote transfer missing counterparty account number',
            context: {
              eventId: input.eventId,
              payNoteDocumentId,
            },
          });
          continue;
        }

        logs.push({
          level: 'info',
          message: 'PayNote transfer triggered',
          context: {
            eventId: input.eventId,
            payerAccountId: account.id,
            payerAccountNumber,
            payeeAccountNumber,
            transferAmountMinor,
          },
        });

        await deps.bankingFacade.transferFunds({
          sourceAccountId: account.id,
          destinationAccountNumber: payeeAccountNumber,
          amountMinor: transferAmountMinor,
          description: transferDescription,
          userId: account.ownerUserId,
          idempotencyKey: payNoteDocumentId,
          payNoteDocumentId,
        });
      } else if (eventType === CAPTURE_FUNDS_EVENT_NAME) {
        logs.push({
          level: 'info',
          message: 'PayNote capture hold triggered',
          context: {
            eventId: input.eventId,
            payerAccountId: account.id,
            payerAccountNumber,
            payeeAccountNumber,
            transferAmountMinor,
          },
        });

        const capturedHold = await deps.bankingFacade.captureHold({
          holdId: payNoteDocumentId,
          userId: account.ownerUserId,
          idempotencyKey: payNoteDocumentId,
          counterpartyAccountNumber: payeeAccountNumber,
          payNoteDocumentId,
        });

        const capturedTransactionId = capturedHold.relatedTransactionId;
        const capturedHoldId = capturedHold.holdId;
        const shouldUpdateHoldId = !updatedRecord.holdId && capturedHoldId;
        const shouldUpdateTransactionId =
          Boolean(capturedTransactionId) &&
          capturedTransactionId !== updatedRecord.transactionId;

        if (shouldUpdateHoldId || shouldUpdateTransactionId) {
          if (shouldUpdateHoldId) {
            updatedRecord.holdId = capturedHoldId;
          }
          if (shouldUpdateTransactionId) {
            updatedRecord.transactionId = capturedTransactionId;
          }
          const updatedAt = deps.clock.now().toISOString();
          updatedRecord.updatedAt = updatedAt;
          await deps.payNoteRepository.savePayNote(updatedRecord);

          await upsertContractRecord({
            contractRepository: deps.contractRepository,
            document: updatedRecord.document,
            sessionId,
            documentId: payNoteDocumentId,
            eventType,
            userId: updatedRecord.userId,
            accountNumber: updatedRecord.accountNumber,
            triggerEvent: eventObject?.triggeredBy,
            emittedEvents,
            relatedTransactionIds: updatedRecord.transactionId
              ? [updatedRecord.transactionId]
              : undefined,
            relatedHoldIds: updatedRecord.holdId
              ? [updatedRecord.holdId]
              : undefined,
            status: updatedRecord.transactionId
              ? 'processed'
              : updatedRecord.holdId
              ? 'reserved'
              : undefined,
            now: updatedAt,
          });

          if (deliveryRecord && shouldUpdateTransactionId) {
            await deps.payNoteDeliveryRepository.saveDelivery({
              ...deliveryRecord,
              transactionId: updatedRecord.transactionId,
              updatedAt,
            });
          }
        }
      } else if (eventType === RESERVE_FUNDS_EVENT_NAME) {
        logs.push({
          level: 'info',
          message: 'PayNote reserve funds triggered',
          context: {
            eventId: input.eventId,
            payerAccountId: account.id,
            payerAccountNumber,
            payeeAccountNumber,
            transferAmountMinor,
          },
        });

        await deps.bankingFacade.reserveFunds({
          holdId: payNoteDocumentId,
          payerAccountNumber,
          amountMinor: transferAmountMinor,
          counterpartyAccountNumber: payeeAccountNumber,
          userId: account.ownerUserId,
          idempotencyKey: payNoteDocumentId,
          payNoteDocumentId,
        });
      } else {
        logs.push({
          level: 'info',
          message: 'PayNote webhook event ignored',
          context: {
            eventId: input.eventId,
            eventType,
            payerAccountNumber,
            payeeAccountNumber,
            transferAmountMinor,
          },
        });
      }
    }
  } catch (error) {
    const note = logAndReturn(
      logs,
      'error',
      'Unexpected error preparing PayNote capture transfer',
      {
        eventId: input.eventId,
        payerAccountNumber,
        payeeAccountNumber,
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return { note, logs };
  }

  return { note: '', logs };
};
