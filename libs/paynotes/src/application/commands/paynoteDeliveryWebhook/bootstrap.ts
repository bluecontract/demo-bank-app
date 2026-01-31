import { DocumentBootstrapRequestedSchema } from '@blue-repository/types/packages/conversation/schemas';
import type { Hold } from '@demo-bank-app/banking';
import { buildCardTransactionDetailsKey } from '@demo-bank-app/banking';
import type { LogEntry, MyOsClient, PayNoteDeliveryRecord } from '../../ports';
import {
  buildChannelBindingsFromContracts,
  getCardTransactionDetailsFromDocument,
  getPayNoteSummaryFromDocument,
  getSynchronySessionIdFromDocument,
  isPayNoteDeliveryDocument,
  isPayNoteDocument,
} from '../../payNoteDelivery/blueUtils';
import { blue } from '../../../blue';
import { log, trace } from '../paynoteWebhook/logging';
import { getString, toSimpleRecord } from '../paynoteWebhook/utils';
import { toBlueNode } from '../webhookUtils';
import type {
  HandlePayNoteDeliveryWebhookDependencies,
  WebhookEventObject,
} from './types';

export type BootstrapRequest = Record<string, unknown>;

type ChannelBindings = Record<string, { email?: string; accountId?: string }>;

type NormalizedBootstrapRequest = {
  bootstrapAssignee?: string;
  document?: Record<string, unknown> | null;
  channelBindings: ChannelBindings;
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
  return payload && typeof payload === 'object' ? payload : null;
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

const normalizeBootstrapRequest = (
  request: BootstrapRequest
): NormalizedBootstrapRequest => ({
  bootstrapAssignee: getString(request.bootstrapAssignee),
  document: toSimpleRecord(request.document),
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
