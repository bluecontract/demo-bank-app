import type { BlueNode } from '@blue-labs/language';
import { DocumentBootstrapRequestedSchema } from '@blue-repository/types/packages/conversation/schemas';
import type {
  BankingRepository,
  CardTransactionDetails,
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
  isPayNoteDeliveryDocument,
  isPayNoteDocument,
  getPayNoteSummaryFromDocument,
  getSynchronySessionIdFromDocument,
} from '../payNoteDelivery/blueUtils';
import { blue } from '../../blue';
import { upsertContractRecord } from '../contracts';

const isTraceEnabled =
  process.env.PAYNOTE_WEBHOOK_TRACE === '1' ||
  (process.env.LOG_LEVEL ?? '').toUpperCase() === 'DEBUG';

const getPayloadSummary = (payload: unknown) => {
  if (payload && typeof payload === 'object') {
    return {
      payloadType: Array.isArray(payload) ? 'array' : 'object',
      payloadKeyCount: Object.keys(payload as Record<string, unknown>).length,
    };
  }
  return { payloadType: typeof payload };
};

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

type WebhookEventObject = {
  sessionId?: string;
  document?: unknown;
  emitted?: unknown[];
  triggeredBy?: unknown;
  created?: string;
  epoch?: number;
};

type WebhookPayload = {
  id?: string;
  type?: string;
  object?: WebhookEventObject;
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
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

const getContractsRecord = (value: unknown): Record<string, unknown> | null => {
  const node = toBlueNode(value);
  if (node) {
    const simple = blue.nodeToJson(node, 'simple');
    if (isRecord(simple)) {
      return simple;
    }
  }
  return isRecord(value) ? value : null;
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

    const binding = getContractsRecord(value);
    if (!binding) {
      return;
    }

    const accountId = getString(binding.accountId);
    const email = getString(binding.email);

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

type BootstrapRequest = Record<string, unknown>;
type ChannelBindings = Record<string, { email?: string; accountId?: string }>;

type NormalizedBootstrapRequest = {
  bootstrapAssignee?: string;
  document?: Record<string, unknown> | null;
  channelBindings: ChannelBindings;
};

const normalizeBootstrapRequest = (
  request: BootstrapRequest
): NormalizedBootstrapRequest => ({
  bootstrapAssignee: getString(request.bootstrapAssignee),
  document: getContractsRecord(request.document),
  channelBindings: normalizeChannelBindings(request.channelBindings),
});

const handleDeliveryBootstrapRequest = async (input: {
  request: NormalizedBootstrapRequest;
  eventId: string;
  bootstrapAssignee: string;
  now: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const { request, eventId, bootstrapAssignee, now, credentials, deps, logs } =
    input;

  if (!request.document || !isPayNoteDeliveryDocument(request.document)) {
    return false;
  }

  const deliveryDocument = request.document;
  const synchronySessionId =
    getSynchronySessionIdFromDocument(deliveryDocument);
  const deliveryError = getString(deliveryDocument.deliveryError);
  if (!synchronySessionId) {
    trace(logs, 'Delivery bootstrap request missing synchrony merchant link', {
      eventId,
      bootstrapAssignee,
    });
  }

  const cardDetails = getCardTransactionDetailsFromDocument(deliveryDocument);
  if (!cardDetails) {
    log(logs, 'warn', 'Delivery missing card transaction details', {
      eventId,
    });
    return true;
  }

  const deliveryId = buildCardTransactionDetailsKey(cardDetails);
  trace(logs, 'Processing delivery bootstrap request', {
    eventId,
    deliveryId,
  });

  const existing = await deps.payNoteDeliveryRepository.getDelivery(deliveryId);
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
    synchronySessionId: existing?.synchronySessionId ?? synchronySessionId,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
  };

  await deps.payNoteDeliveryRepository.saveDelivery(deliveryRecord);

  const channelBindings: ChannelBindings = {
    ...request.channelBindings,
    payNoteDeliverer: { accountId: credentials.accountId },
  };

  trace(logs, 'Bootstrapping PayNote Delivery document', {
    eventId,
    deliveryId,
    channelBindingCount: Object.keys(channelBindings).length,
    hasDeliveryDocument: Boolean(deliveryDocument),
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
      return true;
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

  return true;
};

const handlePayNoteBootstrapRequest = async (input: {
  request: NormalizedBootstrapRequest;
  eventId: string;
  eventObject?: WebhookEventObject;
  documentPayload?: Record<string, unknown>;
  now: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const {
    request,
    eventId,
    eventObject,
    documentPayload,
    now,
    credentials,
    deps,
    logs,
  } = input;

  if (!request.document || !isPayNoteDocument(request.document)) {
    return false;
  }

  const payNoteDocument = request.document;
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
        return true;
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
      return true;
    }
  }

  const channelBindings: ChannelBindings = {
    ...request.channelBindings,
    payerChannel: { accountId: credentials.accountId },
    guarantorChannel: { accountId: credentials.accountId },
  };

  trace(logs, 'Bootstrapping PayNote document', {
    eventId,
    deliveryId,
    channelBindingCount: Object.keys(channelBindings).length,
    hasPayNoteDocument: Boolean(payNoteDocument),
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
    return true;
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

  return true;
};

const handleBootstrapRequests = async (input: {
  requests: BootstrapRequest[];
  eventId: string;
  eventObject?: WebhookEventObject;
  documentPayload?: Record<string, unknown>;
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const { requests, eventId, eventObject, documentPayload, now, deps, logs } =
    input;
  const credentials = await deps.myOsClient.getCredentials();

  for (const request of requests) {
    const normalized = normalizeBootstrapRequest(request);
    const bootstrapAssignee = normalized.bootstrapAssignee;

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

    if (!normalized.document) {
      log(logs, 'warn', 'Bootstrap request missing document', { eventId });
      continue;
    }

    if (
      await handleDeliveryBootstrapRequest({
        request: normalized,
        eventId,
        bootstrapAssignee,
        now,
        credentials,
        deps,
        logs,
      })
    ) {
      continue;
    }

    if (
      await handlePayNoteBootstrapRequest({
        request: normalized,
        eventId,
        eventObject,
        documentPayload,
        now,
        credentials,
        deps,
        logs,
      })
    ) {
      continue;
    }

    log(logs, 'warn', 'Bootstrap request rejected (unsupported document)', {
      eventId,
      bootstrapAssignee,
    });
  }
};

type DeliveryMatchType = 'documentId' | 'sessionId' | 'cardDetails' | 'new';

const resolveExistingDelivery = async (input: {
  deliveryDocumentId?: string;
  sessionId?: string;
  cardDetails: CardTransactionDetails;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<{
  existing: PayNoteDeliveryRecord | null;
  matchedBy: DeliveryMatchType;
}> => {
  const { deliveryDocumentId, sessionId, cardDetails, deps } = input;
  let existing: PayNoteDeliveryRecord | null = null;
  let matchedBy: DeliveryMatchType = 'new';

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

  return { existing, matchedBy };
};

const buildDeliveryRecord = (input: {
  existing: PayNoteDeliveryRecord | null;
  deliveryId: string;
  cardDetails: CardTransactionDetails;
  documentPayload: Record<string, unknown>;
  eventObject?: WebhookEventObject;
  deliveryDocumentId?: string;
  sessionId?: string;
  now: string;
}): PayNoteDeliveryRecord => {
  const {
    existing,
    deliveryId,
    cardDetails,
    documentPayload,
    eventObject,
    deliveryDocumentId,
    sessionId,
    now,
  } = input;

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

  return deliveryRecord;
};

const identifyDeliveryTransaction = async (input: {
  deliveryRecord: PayNoteDeliveryRecord;
  cardDetails: CardTransactionDetails;
  eventId: string;
  deliveryId: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<Hold | null> => {
  const { deliveryRecord, cardDetails, eventId, deliveryId, deps, logs } =
    input;

  if (deliveryRecord.userId) {
    return null;
  }

  const hold = await deps.holdRepository.getHoldByCardTransactionDetails(
    cardDetails
  );

  if (!hold) {
    deliveryRecord.transactionIdentificationStatus = 'failed';
    trace(logs, 'Delivery transaction identification lookup', {
      eventId,
      deliveryId,
      holdId: null,
      status: deliveryRecord.transactionIdentificationStatus,
    });
    return null;
  }

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

  return hold;
};

const syncHoldPayNoteReference = async (input: {
  deliveryRecord: PayNoteDeliveryRecord;
  identifiedHold: Hold | null;
  deliveryDocumentId?: string;
  eventId: string;
  deliveryId: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const {
    deliveryRecord,
    identifiedHold,
    deliveryDocumentId,
    eventId,
    deliveryId,
    deps,
    logs,
  } = input;

  const holdId = deliveryRecord.holdId ?? identifiedHold?.holdId;
  const payNoteReferenceId =
    deliveryRecord.payNoteDocumentId ?? deliveryDocumentId;

  if (!holdId || !payNoteReferenceId) {
    return;
  }

  const hold = identifiedHold ?? (await deps.holdRepository.getHold(holdId));
  if (!hold) {
    return;
  }

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
};

const reportIdentificationStatusIfNeeded = async (input: {
  deliveryRecord: PayNoteDeliveryRecord;
  sessionId?: string;
  eventId: string;
  deliveryId: string;
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const { deliveryRecord, sessionId, eventId, deliveryId, now, deps, logs } =
    input;

  if (
    deliveryRecord.identificationReportedAt ||
    !deliveryRecord.transactionIdentificationStatus ||
    !['identified', 'failed'].includes(
      deliveryRecord.transactionIdentificationStatus
    )
  ) {
    return;
  }

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
    return;
  }

  const credentials = await deps.myOsClient.getCredentials();
  let reported = false;
  let lastResponse: { status: number; body?: unknown } | null = null;

  for (const operationSessionId of operationSessionIds) {
    const response = await deps.myOsClient.runDocumentOperation({
      credentials,
      sessionId: operationSessionId,
      operation: 'updateTransactionIdentificationStatus',
      payload: deliveryRecord.transactionIdentificationStatus === 'identified',
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
};

const persistDeliveryRecord = async (input: {
  deliveryRecord: PayNoteDeliveryRecord;
  sessionId?: string;
  deliveryDocumentId?: string;
  eventType?: string;
  eventObject?: WebhookEventObject;
  emitted: unknown[];
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<void> => {
  const {
    deliveryRecord,
    sessionId,
    deliveryDocumentId,
    eventType,
    eventObject,
    emitted,
    now,
    deps,
  } = input;

  await deps.payNoteDeliveryRepository.saveDelivery(deliveryRecord);
  await upsertContractRecord({
    contractRepository: deps.contractRepository,
    document: deliveryRecord.deliveryDocument,
    sessionId,
    documentId: deliveryRecord.deliveryDocumentId ?? deliveryDocumentId,
    eventType,
    userId: deliveryRecord.userId,
    accountNumber: deliveryRecord.accountNumber,
    triggerEvent: eventObject?.triggeredBy,
    emittedEvents: emitted,
    relatedTransactionIds: deliveryRecord.transactionId
      ? [deliveryRecord.transactionId]
      : undefined,
    relatedHoldIds: deliveryRecord.holdId ? [deliveryRecord.holdId] : undefined,
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
        payNoteBootstrapRequestedAt: deliveryRecord.payNoteBootstrapRequestedAt,
      }),
    },
    now,
  });
};

const getPayNoteBootstrapDocument = (
  documentPayload: Record<string, unknown>
): Record<string, unknown> | null => {
  const request = getContractsRecord(documentPayload.payNoteBootstrapRequest);
  return getContractsRecord(request?.document);
};

const handleDeliveryDocumentUpdate = async (input: {
  eventId: string;
  eventType?: string;
  eventObject?: WebhookEventObject;
  documentPayload: Record<string, unknown>;
  emitted: unknown[];
  now: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const {
    eventId,
    eventType,
    eventObject,
    documentPayload,
    emitted,
    now,
    deps,
    logs,
  } = input;

  const cardDetails = getCardTransactionDetailsFromDocument(documentPayload);
  if (!cardDetails) {
    log(logs, 'warn', 'Delivery event missing card transaction details', {
      eventId,
    });
    return;
  }

  const deliveryId = buildCardTransactionDetailsKey(cardDetails);
  const sessionId = getString(eventObject?.sessionId);

  const deliveryDocumentId = await resolveDocumentId(sessionId, logs, deps);
  trace(logs, 'Resolved delivery document id', {
    eventId,
    sessionId,
    deliveryDocumentId: deliveryDocumentId ?? null,
  });

  const { existing, matchedBy } = await resolveExistingDelivery({
    deliveryDocumentId,
    sessionId,
    cardDetails,
    deps,
  });

  const deliveryRecord = buildDeliveryRecord({
    existing,
    deliveryId,
    cardDetails,
    documentPayload,
    eventObject,
    deliveryDocumentId,
    sessionId,
    now,
  });

  trace(logs, 'Resolved PayNote Delivery record', {
    eventId,
    deliveryId,
    deliveryDocumentId,
    sessionId,
    matchedBy,
    existingDeliveryId: existing?.deliveryId,
  });

  const identifiedHold = await identifyDeliveryTransaction({
    deliveryRecord,
    cardDetails,
    eventId,
    deliveryId,
    deps,
    logs,
  });

  await syncHoldPayNoteReference({
    deliveryRecord,
    identifiedHold,
    deliveryDocumentId,
    eventId,
    deliveryId,
    deps,
    logs,
  });

  await reportIdentificationStatusIfNeeded({
    deliveryRecord,
    sessionId,
    eventId,
    deliveryId,
    now,
    deps,
    logs,
  });

  await persistDeliveryRecord({
    deliveryRecord,
    sessionId,
    deliveryDocumentId,
    eventType,
    eventObject,
    emitted,
    now,
    deps,
  });

  const payNotePayload = getPayNoteBootstrapDocument(documentPayload);
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
};

export const handlePayNoteDeliveryWebhookEvent = async (
  input: HandlePayNoteDeliveryWebhookInput,
  deps: HandlePayNoteDeliveryWebhookDependencies
): Promise<HandlePayNoteDeliveryWebhookResult> => {
  const logs: LogEntry[] = [];
  const payload = input.payload as WebhookPayload;

  const eventId = input.eventId ?? payload?.id;
  const eventType = payload?.type;

  if (!eventId) {
    log(logs, 'warn', 'Webhook payload missing event id', {
      payloadSummary: getPayloadSummary(input.payload),
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

  const isDeliveryDoc = documentPayload
    ? isPayNoteDeliveryDocument(documentPayload)
    : false;

  trace(logs, 'PayNote Delivery webhook received', {
    eventId,
    eventType: payload?.type,
    sessionId: eventObject?.sessionId,
    hasDocument: Boolean(documentPayload),
    emittedCount: emitted.length,
    bootstrapRequestCount: documentBootstrapRequests.length,
    documentBootstrapRequestCount: documentBootstrapRequests.length,
    isDeliveryDoc,
  });

  if (!documentBootstrapRequests.length && !isDeliveryDoc) {
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

  if (documentBootstrapRequests.length > 0) {
    await handleBootstrapRequests({
      requests: documentBootstrapRequests,
      eventId,
      eventObject,
      documentPayload,
      now,
      deps,
      logs,
    });
  }

  if (documentPayload && isDeliveryDoc) {
    await handleDeliveryDocumentUpdate({
      eventId,
      eventType,
      eventObject,
      documentPayload,
      emitted,
      now,
      deps,
      logs,
    });
  }

  return { handled: true, logs };
};
