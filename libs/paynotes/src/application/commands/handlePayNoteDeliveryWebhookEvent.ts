import type { BlueNode } from '@blue-labs/language';
import {
  DocumentBootstrapRequestedSchema,
  EventSchema,
} from '@blue-repository/types/packages/conversation/schemas';
import { PayNoteSchema } from '@blue-repository/types/packages/paynote/schemas';
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

const unwrapNodeValue = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  return 'value' in record ? record.value : value;
};

const getString = (value: unknown): string | undefined => {
  const unwrapped = unwrapNodeValue(value);
  if (typeof unwrapped !== 'string') {
    return undefined;
  }
  const trimmed = unwrapped.trim();
  return trimmed.length ? trimmed : undefined;
};

const getDocumentBootstrapRequestFromEvent = (
  event: unknown
): Record<string, unknown> | null => {
  const node = toBlueNode(event);
  if (
    !node ||
    !blue.isTypeOf(node, DocumentBootstrapRequestedSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return null;
  }

  const payload = blue.nodeToJson(node, 'simple') as
    | Record<string, unknown>
    | undefined;
  return payload && typeof payload === 'object' ? payload : null;
};

const getLegacyBootstrapDeliveryFromEvent = (
  event: unknown
): Record<string, unknown> | null => {
  const node = toBlueNode(event);
  if (!node) {
    return null;
  }

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

const isPayNoteDocument = (document: unknown): boolean => {
  if (!document || typeof document !== 'object') {
    return false;
  }
  try {
    const node = blue.jsonValueToNode(document);
    return blue.isTypeOf(node, PayNoteSchema, {
      checkSchemaExtensions: true,
    });
  } catch {
    return false;
  }
};

const normalizeChannelBindings = (
  bindings: unknown
): Record<string, { email?: string; accountId?: string }> => {
  if (!bindings || typeof bindings !== 'object') {
    return {};
  }

  const record = bindings as Record<string, unknown>;
  const output: Record<string, { email?: string; accountId?: string }> = {};

  Object.entries(record).forEach(([key, value]) => {
    if (!key) {
      return;
    }

    const binding = unwrapNodeValue(value);
    if (!binding || typeof binding !== 'object') {
      return;
    }

    const bindingRecord = binding as Record<string, unknown>;
    const accountId = getString(bindingRecord.accountId);
    const email = getString(bindingRecord.email);

    if (accountId) {
      output[key] = { accountId };
    } else if (email) {
      output[key] = { email };
    }
  });

  return output;
};

const isBootstrapAssigneeMatch = (
  requestingDocument: Record<string, unknown> | undefined,
  bootstrapAssignee: string | undefined,
  myOsAccountId: string
): boolean => {
  if (!requestingDocument || !bootstrapAssignee) {
    return false;
  }
  const contracts = getContractsRecord(requestingDocument.contracts);
  if (!contracts) {
    return false;
  }

  const bindings = buildChannelBindingsFromContracts(contracts);
  return bindings[bootstrapAssignee]?.accountId === myOsAccountId;
};

const extractBootstrapSessionId = (response: {
  body?: unknown;
}): string | undefined => {
  const body = response.body as { sessionId?: unknown } | undefined;
  return typeof body?.sessionId === 'string' ? body.sessionId : undefined;
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
  const documentPayload =
    getContractsRecord(eventObject?.document) ?? undefined;

  const emitted = Array.isArray(eventObject?.emitted)
    ? eventObject?.emitted
    : [];
  const documentBootstrapRequests = emitted
    .map(event => getDocumentBootstrapRequestFromEvent(event))
    .filter((request): request is Record<string, unknown> => request !== null);
  const legacyBootstrapDeliveries = emitted
    .map(event => getLegacyBootstrapDeliveryFromEvent(event))
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
    bootstrapRequestCount:
      documentBootstrapRequests.length + legacyBootstrapDeliveries.length,
    documentBootstrapRequestCount: documentBootstrapRequests.length,
    legacyBootstrapRequestCount: legacyBootstrapDeliveries.length,
    isDeliveryDoc,
  });

  if (
    !documentBootstrapRequests.length &&
    !legacyBootstrapDeliveries.length &&
    !isDeliveryDoc
  ) {
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

  if (
    documentBootstrapRequests.length > 0 ||
    legacyBootstrapDeliveries.length > 0
  ) {
    const credentials = await deps.myOsClient.getCredentials();

    for (const request of documentBootstrapRequests) {
      const requestedDocument = getContractsRecord(
        unwrapNodeValue(request.document)
      );
      const bootstrapAssignee = getString(request.bootstrapAssignee);

      if (!bootstrapAssignee) {
        log(logs, 'warn', 'Bootstrap request missing bootstrapAssignee', {
          eventId,
        });
        continue;
      }

      if (
        !isBootstrapAssigneeMatch(
          documentPayload,
          bootstrapAssignee,
          credentials.accountId
        )
      ) {
        trace(logs, 'Bootstrap request ignored (not assigned)', {
          eventId,
          bootstrapAssignee,
        });
        continue;
      }

      if (!requestedDocument) {
        log(logs, 'warn', 'Bootstrap request missing document', { eventId });
        continue;
      }

      const requestBindings = normalizeChannelBindings(request.channelBindings);

      if (isPayNoteDeliveryDocument(requestedDocument)) {
        const deliveryDocument = requestedDocument;
        const synchronySessionId =
          getSynchronySessionIdFromDocument(deliveryDocument);
        const deliveryError = getString(deliveryDocument.deliveryError);
        if (!synchronySessionId) {
          trace(
            logs,
            'Delivery bootstrap request missing synchrony merchant link',
            {
              eventId,
              bootstrapAssignee,
            }
          );
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
            existing?.synchronySessionId ?? synchronySessionId,
          updatedAt: now,
          createdAt: existing?.createdAt ?? now,
        };

        await deps.payNoteDeliveryRepository.saveDelivery(deliveryRecord);

        const channelBindings = {
          ...requestBindings,
          payNoteDeliverer: { accountId: credentials.accountId },
          payNoteReceiver: { accountId: credentials.accountId },
        };

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

        if (response.ok && deliveryError) {
          const bootstrapSessionId = extractBootstrapSessionId(response);
          if (!bootstrapSessionId) {
            log(
              logs,
              'error',
              'Failed to report PayNote Delivery bootstrap error (missing session id)',
              { eventId, deliveryId }
            );
            continue;
          }

          const reportResponse = await deps.myOsClient.runDocumentOperation({
            credentials,
            sessionId: bootstrapSessionId,
            operation: 'reportDeliveryError',
            payload: deliveryError,
          });

          if (!reportResponse.ok) {
            log(logs, 'error', 'Failed to report PayNote Delivery error', {
              eventId,
              deliveryId,
              status: reportResponse.status,
              body: reportResponse.body,
            });
          } else {
            log(logs, 'info', 'Reported PayNote Delivery error', {
              eventId,
              deliveryId,
            });
          }
        }
        continue;
      }

      if (isPayNoteDocument(requestedDocument)) {
        const payNoteDocument = requestedDocument;
        const requestingSessionId = getString(eventObject?.sessionId);
        const requestingDeliveryCardDetails = documentPayload
          ? getCardTransactionDetailsFromDocument(documentPayload)
          : null;
        const deliveryId = requestingDeliveryCardDetails
          ? buildCardTransactionDetailsKey(requestingDeliveryCardDetails)
          : undefined;
        const existingDelivery = deliveryId
          ? await deps.payNoteDeliveryRepository.getDelivery(deliveryId)
          : requestingSessionId
          ? await deps.payNoteDeliveryRepository.getDeliveryBySessionId(
              requestingSessionId
            )
          : null;
        const payNoteSummary = getPayNoteSummaryFromDocument(payNoteDocument);
        const payNoteAmountMinor = payNoteSummary.amountMinor;

        if (payNoteAmountMinor !== undefined) {
          let hold: Hold | null = null;
          if (existingDelivery?.holdId) {
            hold = await deps.holdRepository.getHold(existingDelivery.holdId);
          }
          if (!hold && requestingDeliveryCardDetails) {
            hold = await deps.holdRepository.getHoldByCardTransactionDetails(
              requestingDeliveryCardDetails
            );
          }

          if (hold && hold.amountMinor !== payNoteAmountMinor) {
            const deliveryError = `PayNote amount (${payNoteAmountMinor}) does not match transaction amount (${hold.amountMinor})`;
            log(
              logs,
              'error',
              'PayNote bootstrap request rejected (amount mismatch)',
              {
                eventId,
                deliveryId,
                holdId: hold.holdId,
                payNoteAmountMinor,
                holdAmountMinor: hold.amountMinor,
              }
            );

            if (!requestingSessionId) {
              log(
                logs,
                'error',
                'Failed to report PayNote bootstrap error (missing session id)',
                {
                  eventId,
                  deliveryId,
                  holdId: hold.holdId,
                }
              );
              continue;
            }

            const reportResponse = await deps.myOsClient.runDocumentOperation({
              credentials,
              sessionId: requestingSessionId,
              operation: 'reportDeliveryError',
              payload: deliveryError,
            });

            if (!reportResponse.ok) {
              log(logs, 'error', 'Failed to report PayNote delivery error', {
                eventId,
                deliveryId,
                status: reportResponse.status,
                body: reportResponse.body,
              });
            } else {
              log(logs, 'info', 'Reported PayNote delivery error', {
                eventId,
                deliveryId,
              });
            }
            continue;
          }
        }

        const channelBindings = {
          ...requestBindings,
          payerChannel: { accountId: credentials.accountId },
          guarantorChannel: { accountId: credentials.accountId },
        };

        trace(logs, 'Bootstrapping PayNote document', {
          eventId,
          payload: {
            channelBindings,
            document: payNoteDocument,
          },
        });

        const response = await deps.myOsClient.bootstrapDocument({
          credentials,
          payload: {
            channelBindings,
            document: payNoteDocument,
          },
        });

        if (!response.ok) {
          log(logs, 'error', 'PayNote bootstrap failed', {
            eventId,
            status: response.status,
            body: response.body,
          });
          continue;
        }

        const bootstrapSessionId = extractBootstrapSessionId(response);

        if (existingDelivery) {
          await deps.payNoteDeliveryRepository.saveDelivery({
            ...existingDelivery,
            payNoteBootstrapRequestedAt: now,
            payNoteBootstrapSessionId:
              existingDelivery.payNoteBootstrapSessionId ?? bootstrapSessionId,
            updatedAt: now,
          });
        }

        log(logs, 'info', 'PayNote bootstrap requested', {
          eventId,
          bootstrapSessionId,
          deliveryId: existingDelivery?.deliveryId ?? deliveryId,
        });
        continue;
      }

      log(logs, 'warn', 'Bootstrap request rejected (unsupported document)', {
        eventId,
        bootstrapAssignee,
      });
    }

    for (const delivery of legacyBootstrapDeliveries) {
      const deliveryDocument = delivery;

      const cardDetails =
        getCardTransactionDetailsFromDocument(deliveryDocument);
      if (!cardDetails) {
        log(logs, 'warn', 'Legacy delivery missing card transaction details', {
          eventId,
        });
        continue;
      }

      const deliveryId = buildCardTransactionDetailsKey(cardDetails);
      trace(logs, 'Processing legacy delivery bootstrap request', {
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
          existing?.synchronySessionId ??
          getSynchronySessionIdFromDocument(deliveryDocument),
        updatedAt: now,
        createdAt: existing?.createdAt ?? now,
      };

      await deps.payNoteDeliveryRepository.saveDelivery(deliveryRecord);

      const contracts = getContractsRecord(deliveryDocument.contracts) ?? {};
      const channelBindings = {
        ...buildChannelBindingsFromContracts(contracts),
        payNoteDeliverer: { accountId: credentials.accountId },
        payNoteReceiver: { accountId: credentials.accountId },
      };

      const response = await deps.myOsClient.bootstrapDocument({
        credentials,
        payload: {
          channelBindings,
          document: deliveryDocument,
        },
      });

      if (!response.ok) {
        log(logs, 'error', 'Legacy PayNote Delivery bootstrap failed', {
          eventId,
          status: response.status,
          body: response.body,
        });
      } else {
        log(logs, 'info', 'Legacy PayNote Delivery bootstrap requested', {
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

    const payNotePayload = getContractsRecord(
      unwrapNodeValue(
        (
          getContractsRecord(documentPayload.payNoteBootstrapRequest) as
            | Record<string, unknown>
            | undefined
        )?.document
      )
    );
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
