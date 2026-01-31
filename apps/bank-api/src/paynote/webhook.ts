import { ServerInferRequest } from '@ts-rest/core';
import {
  bankApiContract,
  getSupportedContractForDocument,
} from '@demo-bank-app/shared-bank-api-contract';
import {
  handleWebhookEvent as handleWebhookEventUseCase,
  handlePayNoteDeliveryWebhookEvent,
  handlePayNoteBootstrapWebhookEvent,
  getPayloadSummary,
} from '@demo-bank-app/paynotes';
import { Blue } from '@blue-labs/language';
import { repository } from '@blue-repository/types';
import { DocumentSessionBootstrapSchema } from '@blue-repository/types/packages/myos/schemas';
import { getDependencies } from './dependencies';
import { prefetchContractSummaryForSessionId } from '../contracts/generateContractSummary';

const blue = new Blue({
  repositories: [repository],
});

const isTraceEnabled =
  process.env.PAYNOTE_WEBHOOK_TRACE === '1' ||
  (process.env.LOG_LEVEL ?? '').toUpperCase() === 'DEBUG';

const getEventTypeName = (event: unknown): string | undefined => {
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

const classifyDocumentType = (document: unknown) => {
  try {
    const node = blue.jsonValueToNode(document);
    const supportedContract = getSupportedContractForDocument(document);
    return {
      isPayNote: supportedContract?.typeName === 'PayNote/PayNote',
      isDelivery: supportedContract?.typeName === 'PayNote/PayNote Delivery',
      isBootstrap: blue.isTypeOf(node, DocumentSessionBootstrapSchema, {
        checkSchemaExtensions: true,
      }),
    };
  } catch {
    return { isPayNote: false, isDelivery: false, isBootstrap: false };
  }
};

export const payNoteWebhookHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['payNoteWebhook']
  >
) => {
  const {
    logger,
    getOpenAiApiKey,
    myOsClient,
    bankingFacade,
    payNoteRepository,
    payNoteDeliveryRepository,
    payNoteBootstrapRepository,
    contractRepository,
    bankingRepository,
    holdRepository,
    clock,
  } = await getDependencies();

  const body = request.body ?? {};
  let eventId = typeof body.id === 'string' ? body.id : undefined;
  let payload = body;
  const trace = (message: string, context?: Record<string, unknown>) => {
    if (!isTraceEnabled) {
      return;
    }
    logger.debug(message, context);
  };
  const logHandlerResult = (
    result: {
      logs: Array<{
        level: string;
        message: string;
        context?: Record<string, unknown>;
      }>;
    } | null,
    skippedMessage: string
  ) => {
    if (!result) {
      trace(skippedMessage, { eventId });
      return;
    }

    result.logs.forEach(entry => {
      if (entry.level === 'error') {
        logger.error(entry.message, entry.context);
      } else if (entry.level === 'warn') {
        logger.warn(entry.message, entry.context);
      } else {
        logger.debug(entry.message, entry.context);
      }
    });
  };

  const hasFullPayload =
    typeof payload === 'object' &&
    payload !== null &&
    ('object' in payload || 'type' in payload);

  trace('PayNote webhook received', {
    eventId,
    hasFullPayload,
  });

  if (!hasFullPayload && eventId) {
    const eventResult = await myOsClient.fetchEvent(eventId);
    if (eventResult.kind !== 'success') {
      logger.error('Failed to download PayNote event from MyOS', {
        eventId,
        ...(eventResult.kind === 'http-error' && {
          status: eventResult.status,
          statusText: eventResult.statusText,
          detail: eventResult.detail,
        }),
        ...(eventResult.kind === 'not-found' && { status: eventResult.status }),
        ...(eventResult.kind === 'parse-error' && {
          status: eventResult.status,
          error:
            eventResult.error instanceof Error
              ? eventResult.error.message
              : String(eventResult.error),
        }),
        ...(eventResult.kind === 'network-error' && {
          error:
            eventResult.error instanceof Error
              ? eventResult.error.message
              : String(eventResult.error),
        }),
      });
      return {
        status: 200 as const,
        body: {
          status: 'ok' as const,
          note: 'Failed to download PayNote event from MyOS',
        },
      };
    }

    payload = eventResult.payload as Record<string, unknown>;
    eventId =
      typeof (payload as { id?: unknown }).id === 'string'
        ? (payload as { id?: string }).id
        : eventId;

    trace('PayNote webhook payload fetched from MyOS', {
      eventId,
    });
  }

  if (!eventId) {
    logger.error('PayNote webhook received payload without valid id', {
      payloadSummary: getPayloadSummary(request.body),
    });
    return {
      status: 200 as const,
      body: {
        status: 'ok' as const,
        note: 'PayNote webhook received payload without valid id',
      },
    };
  }

  const documentPayload = (payload as { object?: { document?: unknown } })
    ?.object?.document;
  const documentType = documentPayload
    ? classifyDocumentType(documentPayload)
    : { isPayNote: false, isDelivery: false, isBootstrap: false };

  const shouldHandleDelivery = documentType.isDelivery;

  trace('PayNote webhook classification', {
    eventId,
    documentType,
    shouldHandleDelivery,
    payloadType: getEventTypeName(payload),
    documentTypeName: documentPayload
      ? getEventTypeName(documentPayload)
      : undefined,
    sessionId: (payload as { object?: { sessionId?: string } })?.object
      ?.sessionId,
    emittedCount: Array.isArray(
      (payload as { object?: { emitted?: unknown[] } })?.object?.emitted
    )
      ? (payload as { object?: { emitted?: unknown[] } })?.object?.emitted
          ?.length
      : 0,
  });

  const deliveryResult = shouldHandleDelivery
    ? await handlePayNoteDeliveryWebhookEvent(
        { eventId, payload },
        {
          myOsClient,
          payNoteDeliveryRepository,
          contractRepository,
          bankingRepository,
          holdRepository,
          clock,
        }
      )
    : null;

  logHandlerResult(deliveryResult, 'PayNote delivery handler skipped');

  const bootstrapResult = documentType.isBootstrap
    ? await handlePayNoteBootstrapWebhookEvent(
        { eventId, payload },
        {
          myOsClient,
          payNoteRepository,
          payNoteDeliveryRepository,
          payNoteBootstrapRepository,
          contractRepository,
          holdRepository,
          clock,
        }
      )
    : null;

  logHandlerResult(bootstrapResult, 'PayNote bootstrap handler skipped');

  const payNoteResult = documentType.isPayNote
    ? await handleWebhookEventUseCase(
        {
          eventId,
          eventPayload: payload,
        },
        {
          myOsClient,
          bankingFacade,
          holdRepository,
          payNoteRepository,
          payNoteDeliveryRepository,
          contractRepository,
          clock,
        }
      )
    : null;

  logHandlerResult(payNoteResult, 'PayNote handler skipped');

  const note =
    payNoteResult?.note ?? bootstrapResult?.note ?? deliveryResult?.note;

  const sessionId = (payload as { object?: { sessionId?: unknown } })?.object
    ?.sessionId;
  if (typeof sessionId === 'string') {
    void prefetchContractSummaryForSessionId({
      sessionId,
      contractRepository,
      getOpenAiApiKey,
      logger,
    });
  }

  return {
    status: 200 as const,
    body: note
      ? ({ status: 'ok' as const, note } as const)
      : ({ status: 'ok' as const } as const),
  };
};
