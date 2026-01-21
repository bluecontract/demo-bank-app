import type { BlueNode } from '@blue-labs/language';
import {
  CaptureFundsRequestedSchema,
  PayNoteSchema,
  ReserveFundsAndCaptureImmediatelyRequestedSchema,
  ReserveFundsRequestedSchema,
} from '@blue-repository/types/packages/paynote/schemas';
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

const isTraceEnabled =
  process.env.PAYNOTE_WEBHOOK_TRACE === '1' ||
  (process.env.LOG_LEVEL ?? '').toUpperCase() === 'DEBUG';

const resolveEventTypeLabel = (event: unknown): string | undefined => {
  if (!event || typeof event !== 'object') {
    return undefined;
  }
  const fallbackType = (event as { type?: { name?: unknown } }).type?.name;
  return typeof fallbackType === 'string' ? fallbackType : undefined;
};

const resolveEventType = (event: unknown): string | undefined => {
  if (!event || typeof event !== 'object') {
    return undefined;
  }

  try {
    const node = blue.jsonValueToNode(event);
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

const getRecordString = (
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  return record ? getString(record[key]) : undefined;
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

  if (!payerAccountNumber) {
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

  const transferDescription =
    getString(payNoteParsed.output.name) ?? 'PayNote transfer';

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

    const events =
      eventObject?.emitted ??
      ([] as Array<{ type?: { name?: string }; amount?: { value?: number } }>);

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

    for (const event of events) {
      const transferAmountMinor: number = event.amount?.value ?? 0;
      const eventType = resolveEventType(event);
      const eventTypeLabel = eventType ?? resolveEventTypeLabel(event);

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

        await deps.bankingFacade.captureHold({
          holdId: payNoteDocumentId,
          userId: account.ownerUserId,
          idempotencyKey: payNoteDocumentId,
          counterpartyAccountNumber: payeeAccountNumber,
          payNoteDocumentId,
        });
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
            eventType: eventTypeLabel,
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
