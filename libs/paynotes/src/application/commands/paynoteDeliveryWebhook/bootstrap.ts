import type { BlueNode } from '@blue-labs/language';
import { DocumentBootstrapRequestedSchema } from '@blue-repository/types/packages/conversation/schemas';
import {
  CardTransactionPayNoteSchema,
  MerchantToCustomerPayNoteSchema,
  PayNoteDeliverySchema,
  PayNoteSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import type { Hold } from '@demo-bank-app/banking';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import type { LogEntry, MyOsClient, PayNoteDeliveryRecord } from '../../ports';
import {
  buildChannelBindingsFromContracts,
  getCardTransactionDetailsFromDocument,
  getPayNoteSummaryFromDocument,
  getSynchronySessionIdFromDocument,
} from '../../payNoteDelivery/blueUtils';
import { blue } from '../../../blue';
import { log, trace } from '../paynoteWebhook/logging';
import { getString, toSimpleRecord } from '../paynoteWebhook/utils';
import { toBlueNode } from '../webhookUtils';
import type {
  HandlePayNoteDeliveryWebhookDependencies,
  WebhookEventObject,
} from './types';

export type BootstrapRequest = {
  rawEvent: unknown;
  request: Record<string, unknown>;
  documentNode: BlueNode | null;
};

type ChannelBindings = Record<string, { email?: string; accountId?: string }>;

type NormalizedBootstrapRequest = {
  bootstrapAssignee?: string;
  document?: Record<string, unknown> | null;
  channelBindings: ChannelBindings;
};

type PayNoteBootstrapContext = {
  payNoteDocument?: Record<string, unknown> | null;
  payNoteDocumentNode: BlueNode | null;
  requestingSessionId?: string;
  requestingDeliveryCardDetails: ReturnType<
    typeof getCardTransactionDetailsFromDocument
  > | null;
  deliveryId?: string;
  senderIdentity?: string;
  payeeIdentity?: string;
  payerIdentity?: string;
};

export const getDocumentBootstrapRequestFromEvent = (
  event: unknown
): BootstrapRequest | null => {
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
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const documentNode = node.getProperties()?.document ?? null;

  return {
    rawEvent: event,
    request: payload,
    documentNode,
  };
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

    const binding = toSimpleRecord(value);
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

const getBindingIdentity = (binding?: {
  email?: string;
  accountId?: string;
}): string | undefined => binding?.accountId ?? binding?.email;

const isBootstrapAssigneeMatch = (
  requestingDocument: Record<string, unknown> | undefined,
  bootstrapAssignee: string | undefined,
  myOsAccountId: string
): boolean => {
  if (!requestingDocument || !bootstrapAssignee) {
    return false;
  }
  const contracts = toSimpleRecord(requestingDocument.contracts);
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

const rejectPayNoteBootstrapRequest = async (input: {
  eventId: string;
  deliveryId?: string;
  requestingSessionId?: string;
  reason: string;
  logMessage: string;
  logContext?: Record<string, unknown>;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const { logMessage, logContext, logs, eventId, deliveryId, ...rest } = input;
  log(logs, 'error', logMessage, { eventId, deliveryId, ...logContext });
  return reportDeliveryError({ eventId, deliveryId, logs, ...rest });
};

const reportDeliveryError = async (input: {
  eventId: string;
  deliveryId?: string;
  requestingSessionId?: string;
  reason: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const {
    eventId,
    deliveryId,
    requestingSessionId,
    reason,
    credentials,
    deps,
    logs,
  } = input;

  if (!requestingSessionId) {
    log(
      logs,
      'error',
      'Failed to report PayNote delivery error (missing session id)',
      { eventId, deliveryId }
    );
    return true;
  }

  const reportResponse = await deps.myOsClient.runDocumentOperation({
    credentials,
    sessionId: requestingSessionId,
    operation: 'reportDeliveryError',
    payload: reason,
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
};

const normalizeBootstrapRequest = (
  request: Record<string, unknown>
): NormalizedBootstrapRequest => ({
  bootstrapAssignee: getString(request.bootstrapAssignee),
  document: toSimpleRecord(request.document),
  channelBindings: normalizeChannelBindings(request.channelBindings),
});

const buildPayNoteBootstrapContext = (input: {
  request: NormalizedBootstrapRequest;
  documentNode: BlueNode | null;
  eventObject?: WebhookEventObject;
  documentPayload?: Record<string, unknown>;
}): PayNoteBootstrapContext => {
  const { request, documentNode, eventObject, documentPayload } = input;
  const payNoteDocument = request.document;
  const requestingSessionId = getString(eventObject?.sessionId);
  const requestingDeliveryCardDetails = documentPayload
    ? getCardTransactionDetailsFromDocument(documentPayload) ?? null
    : null;
  const deliveryId = requestingDeliveryCardDetails
    ? buildCardTransactionDetailsKey(requestingDeliveryCardDetails)
    : undefined;
  const deliveryContracts = documentPayload
    ? toSimpleRecord(documentPayload.contracts)
    : null;
  const deliveryBindings = deliveryContracts
    ? buildChannelBindingsFromContracts(deliveryContracts)
    : {};
  const senderIdentity = getBindingIdentity(deliveryBindings.payNoteSender);
  const payeeIdentity = getBindingIdentity(
    request.channelBindings.payeeChannel
  );
  const payerIdentity = getBindingIdentity(
    request.channelBindings.payerChannel
  );

  return {
    payNoteDocument,
    payNoteDocumentNode: documentNode,
    requestingSessionId,
    requestingDeliveryCardDetails,
    deliveryId,
    senderIdentity,
    payeeIdentity,
    payerIdentity,
  };
};

const ensureValidPayNoteBootstrapRequest = async (input: {
  request: NormalizedBootstrapRequest;
  context: PayNoteBootstrapContext;
  eventId: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<Record<string, unknown> | null> => {
  const { request, context, eventId, credentials, deps, logs } = input;
  const {
    deliveryId,
    requestingSessionId,
    payerIdentity,
    payeeIdentity,
    senderIdentity,
    payNoteDocumentNode,
  } = context;

  if (payerIdentity) {
    await rejectPayNoteBootstrapRequest({
      eventId,
      deliveryId,
      requestingSessionId,
      reason: 'Payer binding must not be provided by merchant.',
      logMessage:
        'PayNote bootstrap request rejected (payer binding supplied by merchant)',
      credentials,
      deps,
      logs,
    });
    return null;
  }

  if (!senderIdentity || !payeeIdentity || payeeIdentity !== senderIdentity) {
    await rejectPayNoteBootstrapRequest({
      eventId,
      deliveryId,
      requestingSessionId,
      reason: 'Payee binding must match the delivery sender.',
      logMessage:
        'PayNote bootstrap request rejected (payee does not match delivery sender)',
      credentials,
      deps,
      logs,
    });
    return null;
  }

  if (!request.document || !payNoteDocumentNode) {
    await rejectPayNoteBootstrapRequest({
      eventId,
      deliveryId,
      requestingSessionId,
      reason:
        'Unsupported PayNote type. Expected PayNote/Card Transaction PayNote.',
      logMessage:
        'PayNote bootstrap request rejected (unsupported PayNote type)',
      credentials,
      deps,
      logs,
    });
    return null;
  }

  if (
    !blue.isTypeOf(payNoteDocumentNode, CardTransactionPayNoteSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    await rejectPayNoteBootstrapRequest({
      eventId,
      deliveryId,
      requestingSessionId,
      reason:
        'Unsupported PayNote type. Expected PayNote/Card Transaction PayNote.',
      logMessage:
        'PayNote bootstrap request rejected (unsupported PayNote type)',
      credentials,
      deps,
      logs,
    });
    return null;
  }

  return request.document;
};

const resolveExistingDelivery = async (input: {
  deliveryId?: string;
  requestingSessionId?: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<PayNoteDeliveryRecord | null> => {
  const { deliveryId, requestingSessionId, deps } = input;
  if (deliveryId) {
    return deps.payNoteDeliveryRepository.getDelivery(deliveryId);
  }
  if (requestingSessionId) {
    return deps.payNoteDeliveryRepository.getDeliveryBySessionId(
      requestingSessionId
    );
  }
  return null;
};

const resolveHoldForBootstrap = async (input: {
  existingDelivery: PayNoteDeliveryRecord | null;
  requestingDeliveryCardDetails: ReturnType<
    typeof getCardTransactionDetailsFromDocument
  > | null;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<Hold | null> => {
  const { existingDelivery, requestingDeliveryCardDetails, deps } = input;
  if (existingDelivery?.holdId) {
    return deps.holdRepository.getHold(existingDelivery.holdId);
  }
  if (requestingDeliveryCardDetails) {
    return deps.holdRepository.getHoldByCardTransactionDetails(
      requestingDeliveryCardDetails
    );
  }
  return null;
};

const isDeliveryDocumentNode = (node: BlueNode | null): boolean =>
  Boolean(
    node &&
      blue.isTypeOf(node, PayNoteDeliverySchema, {
        checkSchemaExtensions: true,
      })
  );

const isPayNoteDocumentNode = (node: BlueNode | null): boolean =>
  Boolean(
    node &&
      blue.isTypeOf(node, PayNoteSchema, {
        checkSchemaExtensions: true,
      })
  );

const resolveExistingDocAllowedBootstrapType = (
  node: BlueNode | null
): string | null => {
  if (
    node &&
    blue.isTypeOf(node, MerchantToCustomerPayNoteSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return 'PayNote/Merchant To Customer PayNote';
  }
  return null;
};

const resolveKnownDeliveryBySessionId = async (input: {
  sessionId?: string;
  deps: HandlePayNoteDeliveryWebhookDependencies;
}): Promise<PayNoteDeliveryRecord | null> => {
  const { sessionId, deps } = input;
  if (!sessionId) {
    return null;
  }
  const byDeliverySession =
    await deps.payNoteDeliveryRepository.getDeliveryBySessionId(sessionId);
  if (byDeliverySession) {
    return byDeliverySession;
  }
  return deps.payNoteDeliveryRepository.getDeliveryByBootstrapSessionId(
    sessionId
  );
};

const handleDeliveryBootstrapRequest = async (input: {
  request: NormalizedBootstrapRequest;
  deliveryDocument: Record<string, unknown>;
  eventId: string;
  bootstrapAssignee: string;
  now: string;
  credentials: Awaited<ReturnType<MyOsClient['getCredentials']>>;
  deps: HandlePayNoteDeliveryWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const {
    request,
    deliveryDocument,
    eventId,
    bootstrapAssignee,
    now,
    credentials,
    deps,
    logs,
  } = input;
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
  requestedDocumentNode: BlueNode | null;
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
    requestedDocumentNode,
    eventId,
    eventObject,
    documentPayload,
    now,
    credentials,
    deps,
    logs,
  } = input;

  const context = buildPayNoteBootstrapContext({
    request,
    documentNode: requestedDocumentNode,
    eventObject,
    documentPayload,
  });
  const payNoteDocument = await ensureValidPayNoteBootstrapRequest({
    request,
    context,
    eventId,
    credentials,
    deps,
    logs,
  });

  if (!payNoteDocument) {
    return true;
  }

  const { deliveryId, requestingSessionId, requestingDeliveryCardDetails } =
    context;
  const existingDelivery = await resolveExistingDelivery({
    deliveryId,
    requestingSessionId,
    deps,
  });
  const payNoteSummary = getPayNoteSummaryFromDocument(payNoteDocument);
  const payNoteAmountMinor = payNoteSummary.amountMinor;

  if (payNoteAmountMinor !== undefined) {
    const hold = await resolveHoldForBootstrap({
      existingDelivery,
      requestingDeliveryCardDetails,
      deps,
    });
    if (hold && hold.amountMinor !== payNoteAmountMinor) {
      const deliveryError = `PayNote amount (${payNoteAmountMinor}) does not match transaction amount (${hold.amountMinor})`;
      return rejectPayNoteBootstrapRequest({
        eventId,
        deliveryId,
        requestingSessionId,
        reason: deliveryError,
        logMessage: 'PayNote bootstrap request rejected (amount mismatch)',
        logContext: {
          holdId: hold.holdId,
          payNoteAmountMinor,
          holdAmountMinor: hold.amountMinor,
        },
        credentials,
        deps,
        logs,
      });
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

export const handleBootstrapRequests = async (input: {
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
  const requestingSessionId = getString(eventObject?.sessionId);
  const requestingDocumentNode = eventObject?.document
    ? toBlueNode(eventObject.document)
    : null;
  const isRequestingDeliveryDoc = isDeliveryDocumentNode(
    requestingDocumentNode
  );
  const requestingContracts = documentPayload
    ? toSimpleRecord(documentPayload.contracts)
    : null;
  const isSynchronyMerchantDoc = Boolean(
    requestingContracts?.synchronyChannel && requestingContracts?.sendPayNote
  );
  let knownDelivery: PayNoteDeliveryRecord | null | undefined;
  const getKnownDelivery = async () => {
    if (knownDelivery !== undefined) {
      return knownDelivery;
    }
    knownDelivery = await resolveKnownDeliveryBySessionId({
      sessionId: requestingSessionId,
      deps,
    });
    return knownDelivery;
  };

  for (const request of requests) {
    const normalized = normalizeBootstrapRequest(request.request);
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

    const requestedDocumentNode = request.documentNode;

    if (isDeliveryDocumentNode(requestedDocumentNode)) {
      if (!isSynchronyMerchantDoc) {
        log(
          logs,
          'warn',
          'Bootstrap request ignored (delivery bootstrap outside synchrony merchant)',
          {
            eventId,
            bootstrapAssignee,
          }
        );
        continue;
      }

      await handleDeliveryBootstrapRequest({
        request: normalized,
        deliveryDocument: normalized.document,
        eventId,
        bootstrapAssignee,
        now,
        credentials,
        deps,
        logs,
      });
      continue;
    }

    const allowedExistingDocType = resolveExistingDocAllowedBootstrapType(
      requestedDocumentNode
    );
    if (allowedExistingDocType && !isRequestingDeliveryDoc) {
      const existingDelivery = await getKnownDelivery();
      if (!existingDelivery) {
        log(
          logs,
          'warn',
          'Bootstrap request ignored (unknown requesting session)',
          {
            eventId,
            bootstrapAssignee,
            requestedTypeName: allowedExistingDocType,
          }
        );
        continue;
      }

      log(
        logs,
        'warn',
        'Bootstrap request ignored (no handler configured for allowed type)',
        {
          eventId,
          bootstrapAssignee,
          requestedTypeName: allowedExistingDocType,
          deliveryId: existingDelivery.deliveryId,
        }
      );
      continue;
    }

    if (isPayNoteDocumentNode(requestedDocumentNode)) {
      if (!isRequestingDeliveryDoc) {
        log(
          logs,
          'warn',
          'Bootstrap request ignored (paynote bootstrap outside delivery document)',
          {
            eventId,
            bootstrapAssignee,
          }
        );
        continue;
      }

      await handlePayNoteBootstrapRequest({
        request: normalized,
        requestedDocumentNode,
        eventId,
        eventObject,
        documentPayload,
        now,
        credentials,
        deps,
        logs,
      });
      continue;
    }

    log(logs, 'warn', 'Bootstrap request rejected (unsupported document)', {
      eventId,
      bootstrapAssignee,
    });
  }
};
