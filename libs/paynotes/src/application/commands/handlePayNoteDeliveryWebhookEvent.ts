import type { BlueNode } from '@blue-labs/language';
import { EventSchema } from '@blue-repository/types/packages/conversation/schemas';
import { PayNoteDeliveryBootstrapRequestedSchema } from '@blue-repository/types/packages/paynote/schemas';
import type {
  BankingRepository,
  Hold,
  HoldRepository,
} from '@demo-bank-app/banking';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import type {
  ClockPort,
  LogEntry,
  MyOsClient,
  MyOsFetchDocumentResult,
  PayNoteDeliveryRecord,
  PayNoteDeliveryRepository,
} from '../ports';
import type { ContractRepository } from '@demo-bank-app/contracts';
import {
  buildChannelBindingsFromContracts,
  ensureTimelineChannel,
  getCardTransactionDetailsFromDocument,
  getDeliveryNameFromDocument,
  getDeliveryStatusFromDocument,
  getPayNoteSummaryFromDocument,
  getSynchronySessionIdFromDocument,
} from '../payNoteDelivery/blueUtils';
import { PayNoteDeliverySchema } from '../payNoteDelivery/schema';
import { blue } from '../../blue';
import { upsertContractRecord } from '../contracts';

const BOOTSTRAP_EVENT_NAMES = [
  'PayNote/PayNote Delivery Bootstrap Requested',
  'PayNote Delivery Bootstrap Requested',
];
const isTraceEnabled =
  process.env.PAYNOTE_WEBHOOK_TRACE === '1' ||
  (process.env.LOG_LEVEL ?? '').toUpperCase() === 'DEBUG';

export interface HandlePayNoteDeliveryWebhookInput {
  payload: unknown;
  eventId?: string;
}

export interface HandlePayNoteDeliveryWebhookDependencies {
  myOsClient: MyOsClient;
  payNoteDeliveryRepository: PayNoteDeliveryRepository;
  contractRepository: ContractRepository;
  bankingRepository: BankingRepository;
  holdRepository: HoldRepository;
  clock: ClockPort;
}

export interface HandlePayNoteDeliveryWebhookResult {
  handled: boolean;
  note?: string;
  logs: LogEntry[];
}

const log = (
  logs: LogEntry[],
  level: LogEntry['level'],
  message: string,
  context?: Record<string, unknown>
) => {
  logs.push({ level, message, context });
};

const trace = (
  logs: LogEntry[],
  message: string,
  context?: Record<string, unknown>
) => {
  if (!isTraceEnabled) {
    return;
  }
  log(logs, 'info', message, context);
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

const getEventKindName = (node: BlueNode): string | undefined => {
  const simple = blue.nodeToJson(node, 'simple') as
    | Record<string, unknown>
    | undefined;
  if (!simple) {
    return undefined;
  }
  const kindValue = simple.kind;
  if (typeof kindValue === 'string') {
    return kindValue;
  }
  if (!kindValue || typeof kindValue !== 'object') {
    return undefined;
  }
  const record = kindValue as { value?: unknown; name?: unknown };
  if (typeof record.value === 'string') {
    return record.value;
  }
  return typeof record.name === 'string' ? record.name : undefined;
};

const getBootstrapDeliveryFromEvent = (
  event: unknown
): Record<string, unknown> | null => {
  const node = toBlueNode(event);
  if (!node) {
    return null;
  }

  const isBootstrapEvent = blue.isTypeOf(
    node,
    PayNoteDeliveryBootstrapRequestedSchema,
    { checkSchemaExtensions: true }
  );
  if (!isBootstrapEvent) {
    if (
      !blue.isTypeOf(node, EventSchema, {
        checkSchemaExtensions: true,
      })
    ) {
      return null;
    }
    const kindName = getEventKindName(node);
    if (!kindName || !BOOTSTRAP_EVENT_NAMES.includes(kindName)) {
      return null;
    }
  }

  const payload = blue.nodeToJson(node, 'official') as
    | Record<string, unknown>
    | undefined;
  const delivery = payload?.delivery;
  if (!delivery || typeof delivery !== 'object') {
    return null;
  }
  return delivery as Record<string, unknown>;
};

const getContractsRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
};

const isPayNoteDeliveryDocument = (document: unknown): boolean => {
  if (!document || typeof document !== 'object') {
    return false;
  }
  try {
    const node = blue.jsonValueToNode(document);
    return blue.isTypeOf(node, PayNoteDeliverySchema, {
      checkSchemaExtensions: true,
    });
  } catch {
    return false;
  }
};

const normalizeSessionIds = (
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

const normalizeDeliverySessionIds = (
  record?: PayNoteDeliveryRecord | null
): string[] | undefined => {
  if (!record) {
    return undefined;
  }
  if (record.deliverySessionIds?.length) {
    return record.deliverySessionIds;
  }
  return record.deliverySessionId ? [record.deliverySessionId] : undefined;
};

const buildOperationSessionIds = (
  primary?: string,
  sessionIds?: string[],
  fallback?: string
): string[] => {
  const unique = new Set<string>();
  if (primary) {
    unique.add(primary);
  }
  (sessionIds ?? []).forEach(id => {
    if (id) {
      unique.add(id);
    }
  });
  if (fallback) {
    unique.add(fallback);
  }
  return Array.from(unique);
};

const updateHoldPayNoteDocumentId = async (
  logs: LogEntry[],
  hold: Hold,
  payNoteDocumentId: string,
  options: { force?: boolean; eventId?: string; deliveryId?: string },
  deps: HandlePayNoteDeliveryWebhookDependencies
) => {
  if (!payNoteDocumentId) {
    return;
  }
  if (hold.payNoteDocumentId === payNoteDocumentId) {
    return;
  }
  if (hold.payNoteDocumentId && !options.force) {
    return;
  }

  await deps.holdRepository.putHoldMeta({
    ...hold,
    payNoteDocumentId,
  });

  trace(logs, 'Updated hold PayNote reference', {
    eventId: options.eventId,
    deliveryId: options.deliveryId,
    holdId: hold.holdId,
    payNoteDocumentId,
    previousPayNoteDocumentId: hold.payNoteDocumentId ?? null,
  });
};

const logFetchDocumentError = (
  logs: LogEntry[],
  result: MyOsFetchDocumentResult,
  sessionId: string
) => {
  switch (result.kind) {
    case 'not-found':
      log(logs, 'error', 'Failed to resolve delivery document from MyOS', {
        sessionId,
        status: result.status,
      });
      return;
    case 'http-error':
      log(logs, 'error', 'Failed to resolve delivery document from MyOS', {
        sessionId,
        status: result.status,
        statusText: result.statusText,
      });
      return;
    case 'parse-error':
      log(logs, 'error', 'Failed to parse delivery document response', {
        sessionId,
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      return;
    case 'network-error':
      log(logs, 'error', 'Unexpected error resolving delivery document', {
        sessionId,
        error:
          result.error instanceof Error
            ? result.error.message
            : String(result.error),
      });
      return;
    default:
      return;
  }
};

const resolveDocumentId = async (
  sessionId: string | undefined,
  logs: LogEntry[],
  deps: HandlePayNoteDeliveryWebhookDependencies
): Promise<string | undefined> => {
  if (!sessionId) {
    return undefined;
  }

  const result = await deps.myOsClient.fetchDocument(sessionId);
  if (result.kind !== 'success') {
    logFetchDocumentError(logs, result, sessionId);
    return undefined;
  }

  return result.document.documentId;
};

export const handlePayNoteDeliveryWebhookEvent = async (
  input: HandlePayNoteDeliveryWebhookInput,
  deps: HandlePayNoteDeliveryWebhookDependencies
): Promise<HandlePayNoteDeliveryWebhookResult> => {
  const logs: LogEntry[] = [];
  const payload = input.payload as {
    id?: string;
    type?: string;
    object?: {
      sessionId?: string;
      document?: unknown;
      emitted?: unknown[];
      triggeredBy?: unknown;
      created?: string;
      epoch?: number;
    };
  };

  const eventId = input.eventId ?? payload?.id;

  if (!eventId) {
    log(logs, 'warn', 'Webhook payload missing event id', {
      payload: input.payload,
    });
    return { handled: false, note: 'Missing event id', logs };
  }

  const eventObject = payload?.object;
  const documentPayload = eventObject?.document as
    | Record<string, unknown>
    | undefined;

  const emitted = Array.isArray(eventObject?.emitted)
    ? eventObject?.emitted
    : [];
  const bootstrapRequests = emitted
    .map(event => getBootstrapDeliveryFromEvent(event))
    .filter(
      (delivery): delivery is Record<string, unknown> => delivery !== null
    );

  const isDeliveryDoc = documentPayload
    ? isPayNoteDeliveryDocument(documentPayload)
    : false;

  trace(logs, 'PayNote Delivery webhook received', {
    eventId,
    eventType: payload?.type,
    sessionId: eventObject?.sessionId,
    hasDocument: Boolean(documentPayload),
    emittedCount: emitted.length,
    bootstrapRequestCount: bootstrapRequests.length,
    isDeliveryDoc,
  });

  if (!bootstrapRequests.length && !isDeliveryDoc) {
    trace(logs, 'Delivery webhook skipped (not a delivery event)', {
      eventId,
      sessionId: eventObject?.sessionId,
      eventType: payload?.type,
    });
    return { handled: false, logs };
  }

  const firstProcess = await deps.payNoteDeliveryRepository.markEventProcessed(
    eventId
  );
  if (!firstProcess) {
    log(logs, 'info', 'PayNote delivery webhook already processed', {
      eventId,
    });
    return { handled: true, logs };
  }

  const now = deps.clock.now().toISOString();

  if (bootstrapRequests.length > 0) {
    const credentials = await deps.myOsClient.getCredentials();

    for (const delivery of bootstrapRequests) {
      const deliveryDocument = {
        ...delivery,
      };

      const deliveryContracts = {
        ...(getContractsRecord(deliveryDocument.contracts) ?? {}),
      };

      const delivererCheck = ensureTimelineChannel(
        deliveryContracts,
        'payNoteDeliverer',
        credentials.accountId
      );
      const receiverCheck = ensureTimelineChannel(
        deliveryContracts,
        'payNoteReceiver',
        credentials.accountId
      );

      if (!delivererCheck.ok || !receiverCheck.ok) {
        log(logs, 'warn', 'Delivery participant validation failed', {
          eventId,
          delivererError: delivererCheck.error,
          receiverError: receiverCheck.error,
        });
        continue;
      }

      deliveryDocument.contracts = deliveryContracts;

      const payNotePayload = getContractsRecord(deliveryDocument.payNote);
      if (payNotePayload) {
        const payNoteContracts = {
          ...(getContractsRecord(payNotePayload.contracts) ?? {}),
        };
        const guarantorCheck = ensureTimelineChannel(
          payNoteContracts,
          'guarantorChannel',
          credentials.accountId
        );
        const payerCheck = ensureTimelineChannel(
          payNoteContracts,
          'payerChannel',
          credentials.accountId
        );

        if (!guarantorCheck.ok || !payerCheck.ok) {
          log(logs, 'warn', 'PayNote channel validation failed', {
            eventId,
            guarantorError: guarantorCheck.error,
            payerError: payerCheck.error,
          });
          continue;
        }

        payNotePayload.contracts = payNoteContracts;
        deliveryDocument.payNote = payNotePayload;
      }
      const cardDetails =
        getCardTransactionDetailsFromDocument(deliveryDocument);

      if (!cardDetails) {
        log(logs, 'warn', 'Delivery missing card transaction details', {
          eventId,
        });
        continue;
      }

      const deliveryId = buildCardTransactionDetailsKey(cardDetails);
      trace(logs, 'Processing delivery bootstrap request', {
        eventId,
        deliveryId,
      });
      const existing = await deps.payNoteDeliveryRepository.getDelivery(
        deliveryId
      );
      const deliveryRecord: PayNoteDeliveryRecord = {
        ...(existing ?? {
          deliveryId,
          createdAt: now,
          updatedAt: now,
        }),
        deliveryId,
        cardTransactionDetails: cardDetails,
        cardTransactionDetailsKey: deliveryId,
        deliveryDocument,
        synchronySessionId:
          existing?.synchronySessionId ?? eventObject?.sessionId,
        updatedAt: now,
        createdAt: existing?.createdAt ?? now,
      };

      await deps.payNoteDeliveryRepository.saveDelivery(deliveryRecord);

      const channelBindings =
        buildChannelBindingsFromContracts(deliveryContracts);

      trace(logs, 'Bootstrapping PayNote Delivery document', {
        eventId,
        deliveryId,
        payload: {
          channelBindings,
          document: deliveryDocument,
        },
      });

      const response = await deps.myOsClient.bootstrapDocument({
        credentials,
        payload: {
          channelBindings,
          document: deliveryDocument,
        },
      });

      if (!response.ok) {
        log(logs, 'error', 'PayNote Delivery bootstrap failed', {
          eventId,
          status: response.status,
          body: response.body,
        });
      } else {
        log(logs, 'info', 'PayNote Delivery bootstrap requested', {
          eventId,
          deliveryId,
        });
      }
    }
  }

  if (documentPayload && isDeliveryDoc) {
    const cardDetails = getCardTransactionDetailsFromDocument(documentPayload);
    if (!cardDetails) {
      log(logs, 'warn', 'Delivery event missing card transaction details', {
        eventId,
      });
      return { handled: true, logs };
    }

    const deliveryId = buildCardTransactionDetailsKey(cardDetails);
    let identifiedHold: Hold | null = null;

    const sessionId =
      typeof eventObject?.sessionId === 'string'
        ? eventObject.sessionId
        : undefined;

    const deliveryDocumentId = await resolveDocumentId(sessionId, logs, deps);
    trace(logs, 'Resolved delivery document id', {
      eventId,
      sessionId,
      deliveryDocumentId: deliveryDocumentId ?? null,
    });

    let existing: PayNoteDeliveryRecord | null = null;
    let matchedBy: 'documentId' | 'sessionId' | 'cardDetails' | 'new' = 'new';
    if (deliveryDocumentId) {
      existing =
        (await deps.payNoteDeliveryRepository.getDeliveryByDocumentId(
          deliveryDocumentId
        )) ?? null;
      if (existing) {
        matchedBy = 'documentId';
      }
    }
    if (!existing && sessionId) {
      existing =
        (await deps.payNoteDeliveryRepository.getDeliveryBySessionId(
          sessionId
        )) ?? null;
      if (existing) {
        matchedBy = 'sessionId';
      }
    }
    if (!existing) {
      existing =
        (await deps.payNoteDeliveryRepository.getDeliveryByCardTransactionDetails(
          cardDetails
        )) ?? null;
      if (existing) {
        matchedBy = 'cardDetails';
      }
    }

    const {
      deliveryStatus,
      transactionIdentificationStatus,
      clientDecisionStatus,
    } = getDeliveryStatusFromDocument(documentPayload);

    const synchronySessionId =
      existing?.synchronySessionId ??
      getSynchronySessionIdFromDocument(documentPayload);

    const deliverySessionIds = normalizeSessionIds(
      normalizeDeliverySessionIds(existing),
      sessionId
    );

    const deliveryRecord: PayNoteDeliveryRecord = {
      ...(existing ?? {
        deliveryId,
        createdAt: now,
        updatedAt: now,
      }),
      deliveryId,
      deliveryDocumentId: deliveryDocumentId ?? existing?.deliveryDocumentId,
      deliverySessionId: existing?.deliverySessionId ?? sessionId,
      deliverySessionIds,
      synchronySessionId,
      cardTransactionDetails: cardDetails,
      cardTransactionDetailsKey: deliveryId,
      deliveryDocument: documentPayload,
      deliveryUpdatedAt: eventObject?.created ?? now,
      deliveryStatus: deliveryStatus ?? existing?.deliveryStatus,
      transactionIdentificationStatus:
        transactionIdentificationStatus ??
        existing?.transactionIdentificationStatus,
      clientDecisionStatus:
        clientDecisionStatus ?? existing?.clientDecisionStatus,
      payNoteDocumentId: existing?.payNoteDocumentId,
      payNoteSessionIds: existing?.payNoteSessionIds,
      payNoteBootstrapSessionId: existing?.payNoteBootstrapSessionId,
      payNoteDocument: existing?.payNoteDocument,
      payNoteUpdatedAt: existing?.payNoteUpdatedAt,
      identificationReportedAt: existing?.identificationReportedAt,
      decisionRecordedAt: existing?.decisionRecordedAt,
      payNoteBootstrapRequestedAt: existing?.payNoteBootstrapRequestedAt,
      accountNumber: existing?.accountNumber,
      userId: existing?.userId,
      holdId: existing?.holdId,
      transactionId: existing?.transactionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (
      deliveryRecord.userId &&
      (!deliveryRecord.transactionIdentificationStatus ||
        deliveryRecord.transactionIdentificationStatus === 'pending')
    ) {
      deliveryRecord.transactionIdentificationStatus = 'identified';
    }

    trace(logs, 'Resolved PayNote Delivery record', {
      eventId,
      deliveryId,
      deliveryDocumentId,
      sessionId,
      matchedBy,
      existingDeliveryId: existing?.deliveryId,
    });

    if (!deliveryRecord.userId) {
      const hold = await deps.holdRepository.getHoldByCardTransactionDetails(
        cardDetails
      );

      if (hold) {
        identifiedHold = hold;
        const accountId = await deps.bankingRepository.getAccountIdByNumber(
          hold.payerAccountNumber
        );
        const account = accountId
          ? await deps.bankingRepository.getAccountById(accountId)
          : null;

        if (account && account.ownerUserId) {
          deliveryRecord.userId = account.ownerUserId;
          deliveryRecord.accountNumber = account.accountNumber;
          deliveryRecord.holdId = hold.holdId;
          deliveryRecord.transactionId = hold.relatedTransactionId;
          deliveryRecord.transactionIdentificationStatus = 'identified';
        } else {
          deliveryRecord.transactionIdentificationStatus = 'failed';
        }
        trace(logs, 'Delivery transaction identification lookup', {
          eventId,
          deliveryId,
          holdId: hold.holdId,
          payerAccountNumber: hold.payerAccountNumber,
          accountId,
          userId: account?.ownerUserId ?? null,
          status: deliveryRecord.transactionIdentificationStatus,
        });
      } else {
        deliveryRecord.transactionIdentificationStatus = 'failed';
        trace(logs, 'Delivery transaction identification lookup', {
          eventId,
          deliveryId,
          holdId: null,
          status: deliveryRecord.transactionIdentificationStatus,
        });
      }
    }

    const holdId = deliveryRecord.holdId ?? identifiedHold?.holdId;
    const payNoteReferenceId =
      deliveryRecord.payNoteDocumentId ?? deliveryDocumentId;
    if (holdId && payNoteReferenceId) {
      const hold =
        identifiedHold ?? (await deps.holdRepository.getHold(holdId));
      if (hold) {
        await updateHoldPayNoteDocumentId(
          logs,
          hold,
          payNoteReferenceId,
          {
            force: Boolean(deliveryRecord.payNoteDocumentId),
            eventId,
            deliveryId,
          },
          deps
        );
      }
    }

    if (
      !deliveryRecord.identificationReportedAt &&
      deliveryRecord.transactionIdentificationStatus &&
      ['identified', 'failed'].includes(
        deliveryRecord.transactionIdentificationStatus
      )
    ) {
      const operationSessionIds = buildOperationSessionIds(
        sessionId,
        deliveryRecord.deliverySessionIds,
        deliveryRecord.deliverySessionId
      );

      if (!operationSessionIds.length) {
        log(
          logs,
          'warn',
          'Delivery identification status not reported (no session id)',
          {
            eventId,
            deliveryId,
          }
        );
      } else {
        const credentials = await deps.myOsClient.getCredentials();
        let reported = false;
        let lastResponse: { status: number; body?: unknown } | null = null;

        for (const operationSessionId of operationSessionIds) {
          const response = await deps.myOsClient.runDocumentOperation({
            credentials,
            sessionId: operationSessionId,
            operation: 'updateTransactionIdentificationStatus',
            payload:
              deliveryRecord.transactionIdentificationStatus === 'identified',
          });

          if (response.ok) {
            deliveryRecord.identificationReportedAt = now;
            trace(logs, 'Reported delivery identification status to MyOS', {
              eventId,
              deliveryId,
              deliverySessionId: operationSessionId,
              status: deliveryRecord.transactionIdentificationStatus,
            });
            reported = true;
            break;
          }

          lastResponse = { status: response.status, body: response.body };
        }

        if (!reported) {
          log(logs, 'error', 'Failed to report identification status', {
            eventId,
            deliveryId,
            deliverySessionIds: operationSessionIds,
            status: lastResponse?.status,
            body: lastResponse?.body,
          });
        }
      }
    }

    await deps.payNoteDeliveryRepository.saveDelivery(deliveryRecord);
    await upsertContractRecord({
      contractRepository: deps.contractRepository,
      document: deliveryRecord.deliveryDocument,
      sessionId,
      documentId: deliveryRecord.deliveryDocumentId ?? deliveryDocumentId,
      userId: deliveryRecord.userId,
      accountNumber: deliveryRecord.accountNumber,
      triggerEvent: eventObject?.triggeredBy,
      emittedEvents: emitted,
      relatedTransactionIds: deliveryRecord.transactionId
        ? [deliveryRecord.transactionId]
        : undefined,
      relatedHoldIds: deliveryRecord.holdId
        ? [deliveryRecord.holdId]
        : undefined,
      status:
        deliveryRecord.clientDecisionStatus ??
        deliveryRecord.transactionIdentificationStatus ??
        deliveryRecord.deliveryStatus,
      statusTimestamps: {
        ...(deliveryRecord.deliveryUpdatedAt && {
          deliveryUpdatedAt: deliveryRecord.deliveryUpdatedAt,
        }),
        ...(deliveryRecord.identificationReportedAt && {
          identificationReportedAt: deliveryRecord.identificationReportedAt,
        }),
        ...(deliveryRecord.decisionRecordedAt && {
          decisionRecordedAt: deliveryRecord.decisionRecordedAt,
        }),
        ...(deliveryRecord.payNoteBootstrapRequestedAt && {
          payNoteBootstrapRequestedAt:
            deliveryRecord.payNoteBootstrapRequestedAt,
        }),
      },
      now,
    });

    const payNotePayload = documentPayload.payNote as
      | Record<string, unknown>
      | undefined;
    const payNoteSummary = getPayNoteSummaryFromDocument(payNotePayload);
    log(logs, 'info', 'PayNote Delivery updated', {
      eventId,
      deliveryId,
      deliveryDocumentId,
      deliveryStatus: deliveryRecord.deliveryStatus,
      transactionIdentificationStatus:
        deliveryRecord.transactionIdentificationStatus,
      clientDecisionStatus: deliveryRecord.clientDecisionStatus,
      deliveryName: getDeliveryNameFromDocument(documentPayload),
      payNoteName: payNoteSummary.name,
    });
  }

  return { handled: true, logs };
};
