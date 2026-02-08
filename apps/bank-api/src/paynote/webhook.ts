import { ServerInferRequest } from '@ts-rest/core';
import {
  bankApiContract,
  getSupportedContractForDocument,
} from '@demo-bank-app/shared-bank-api-contract';
import {
  handleWebhookEvent as handleWebhookEventUseCase,
  handlePayNoteDeliveryWebhookEvent,
  handlePayNoteBootstrapWebhookEvent,
  consumePendingPayNoteBootstrapEvents,
  getDocumentBootstrapRequestFromEvent,
  getPayloadSummary,
  toCompactBlueJsonValue,
} from '@demo-bank-app/paynotes';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Blue } from '@blue-labs/language';
import { repository } from '@blue-repository/types';
import { DocumentSessionBootstrapSchema } from '@blue-repository/types/packages/myos/schemas';
import type { ContractRecord } from '@demo-bank-app/contracts';
import { getDependencies } from './dependencies';
import type {
  ContractSummaryJob,
  PayNoteDeliverySummaryJob,
} from '../summary/types';
import {
  buildContractSummaryInputSnapshot,
  normalizeSourceUpdatedAt,
} from '../summary/inputStore';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';

const blue = new Blue({
  repositories: [repository],
});

let cachedLambdaClient: LambdaClient | null = null;
let cachedSqsClient: SQSClient | null = null;

const getLambdaClient = () => {
  if (cachedLambdaClient) {
    return cachedLambdaClient;
  }

  const region = process.env.AWS_REGION || 'eu-west-1';
  const endpoint = process.env.AWS_ENDPOINT_URL;
  cachedLambdaClient = new LambdaClient({
    region,
    ...(endpoint ? { endpoint } : {}),
  });
  return cachedLambdaClient;
};

const getSqsClient = () => {
  if (cachedSqsClient) {
    return cachedSqsClient;
  }

  const region = process.env.AWS_REGION || 'eu-west-1';
  const endpoint = process.env.AWS_ENDPOINT_URL;
  cachedSqsClient = new SQSClient({
    region,
    ...(endpoint ? { endpoint } : {}),
  });
  return cachedSqsClient;
};

const invokeSummaryLambdaJob = async (
  job: PayNoteDeliverySummaryJob,
  logger: PowertoolsLogger
): Promise<boolean> => {
  const functionName = process.env.SUMMARY_LAMBDA_NAME?.trim();
  if (!functionName) {
    logger.debug('Summary dispatch skipped (missing SUMMARY_LAMBDA_NAME)', {
      type: job.type,
      sessionId: job.sessionId,
    });
    return false;
  }

  try {
    const payload = Buffer.from(JSON.stringify(job));
    const response = await getLambdaClient().send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: payload,
      })
    );

    logger.info('Enqueued summary job', {
      type: job.type,
      sessionId: job.sessionId,
      statusCode: response.StatusCode,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to enqueue summary job', {
      type: job.type,
      sessionId: job.sessionId,
      error: message,
    });
    return false;
  }
};

const enqueueContractSummaryJob = async (
  job: ContractSummaryJob,
  logger: PowertoolsLogger
): Promise<boolean> => {
  const queueUrl = process.env.SUMMARY_QUEUE_URL?.trim();
  if (!queueUrl) {
    logger.error('Summary dispatch skipped (missing SUMMARY_QUEUE_URL)', {
      contractId: job.contractId,
      documentId: job.documentId,
    });
    return false;
  }

  const deduplicationId = `${job.contractId}:${job.summaryInputKey}`;
  try {
    const response = await getSqsClient().send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(job),
        MessageGroupId: job.documentId || job.contractId,
        MessageDeduplicationId: deduplicationId,
      })
    );

    logger.info('Enqueued summary job', {
      type: job.type,
      contractId: job.contractId,
      documentId: job.documentId,
      summaryInputKey: job.summaryInputKey,
      messageId: response.MessageId,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to enqueue summary job', {
      type: job.type,
      contractId: job.contractId,
      documentId: job.documentId,
      summaryInputKey: job.summaryInputKey,
      error: message,
    });
    return false;
  }
};

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

const classifyDocumentType = (
  document: unknown,
  supportedContract?: ReturnType<typeof getSupportedContractForDocument> | null
) => {
  try {
    const node = blue.jsonValueToNode(document);
    const resolvedContract =
      supportedContract ?? getSupportedContractForDocument(document);
    return {
      isPayNote: resolvedContract?.typeName === 'PayNote/PayNote',
      isDelivery: resolvedContract?.typeName === 'PayNote/PayNote Delivery',
      isBootstrap: blue.isTypeOf(node, DocumentSessionBootstrapSchema, {
        checkSchemaExtensions: true,
      }),
      isSupportedContract: Boolean(resolvedContract),
    };
  } catch {
    return {
      isPayNote: false,
      isDelivery: false,
      isBootstrap: false,
      isSupportedContract: false,
    };
  }
};

const hasDocumentBootstrapRequest = (payload: unknown): boolean => {
  const emitted = (payload as { object?: { emitted?: unknown[] } })?.object
    ?.emitted;
  if (!Array.isArray(emitted)) {
    return false;
  }
  return emitted.some(event =>
    Boolean(getDocumentBootstrapRequestFromEvent(event))
  );
};

const toCompactBlueEventArray = (value: unknown): unknown[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map(item => toCompactBlueJsonValue(item));
  }

  if (value && typeof value === 'object') {
    const items = (value as { items?: unknown }).items;
    if (Array.isArray(items)) {
      return items.map(item => toCompactBlueJsonValue(item));
    }
  }

  return undefined;
};

const toCompactContractSnapshot = (
  contract: ContractRecord
): ContractRecord => {
  const compactEmittedEvents = toCompactBlueEventArray(contract.emittedEvents);
  const compactSummaryEmittedEvents = toCompactBlueEventArray(
    contract.summaryEmittedEvents
  );

  return {
    ...contract,
    ...(contract.document !== undefined
      ? {
          document: toCompactBlueJsonValue(contract.document) as Record<
            string,
            unknown
          >,
        }
      : {}),
    ...(contract.triggerEvent !== undefined
      ? { triggerEvent: toCompactBlueJsonValue(contract.triggerEvent) }
      : {}),
    ...(compactEmittedEvents !== undefined
      ? {
          emittedEvents: compactEmittedEvents,
        }
      : {}),
    ...(contract.summaryDocument !== undefined
      ? {
          summaryDocument: toCompactBlueJsonValue(
            contract.summaryDocument
          ) as Record<string, unknown>,
        }
      : {}),
    ...(contract.summaryTriggerEvent !== undefined
      ? {
          summaryTriggerEvent: toCompactBlueJsonValue(
            contract.summaryTriggerEvent
          ),
        }
      : {}),
    ...(compactSummaryEmittedEvents !== undefined
      ? {
          summaryEmittedEvents: compactSummaryEmittedEvents,
        }
      : {}),
  };
};

export const payNoteWebhookHandler = async (
  request: ServerInferRequest<
    (typeof bankApiContract)['banking']['payNoteWebhook']
  >
) => {
  const {
    logger,
    myOsClient,
    bankingFacade,
    payNoteRepository,
    payNoteDeliveryRepository,
    payNoteBootstrapRepository,
    bootstrapContextRepository,
    pendingBootstrapEventRepository,
    contractRepository,
    summaryInputStore,
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
  const supportedContract = documentPayload
    ? getSupportedContractForDocument(documentPayload)
    : null;
  const documentType = documentPayload
    ? classifyDocumentType(documentPayload, supportedContract)
    : {
        isPayNote: false,
        isDelivery: false,
        isBootstrap: false,
        isSupportedContract: false,
      };

  const shouldHandleDelivery =
    documentType.isDelivery || hasDocumentBootstrapRequest(payload);

  trace('PayNote webhook classification', {
    eventId,
    documentType,
    supportedContractType: supportedContract?.typeName ?? null,
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
          bootstrapContextRepository,
          clock,
          enqueuePayNoteDeliverySummary: async input => {
            await invokeSummaryLambdaJob(
              {
                type: 'paynote-delivery-summary',
                sessionId: input.sessionId,
                reason: input.reason,
                force: input.force,
              },
              logger
            );
          },
          consumePendingBootstrapEvents: async bootstrapSessionId => {
            const consumeResult = await consumePendingPayNoteBootstrapEvents(
              { bootstrapSessionId },
              {
                myOsClient,
                payNoteRepository,
                payNoteDeliveryRepository,
                payNoteBootstrapRepository,
                bootstrapContextRepository,
                pendingBootstrapEventRepository,
                contractRepository,
                holdRepository,
                clock,
              }
            );
            logHandlerResult(consumeResult, 'No pending bootstrap events');
          },
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
          bootstrapContextRepository,
          pendingBootstrapEventRepository,
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
          bootstrapContextRepository,
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
  if (typeof sessionId === 'string' && documentType.isSupportedContract) {
    const contract = await contractRepository.getContractBySessionId(sessionId);
    if (!contract) {
      logger.debug(
        'Skipping contract-summary enqueue (no contract for session; non-canonical session?)',
        {
          eventId,
          sessionId,
        }
      );
    } else if (contract.sessionId !== sessionId) {
      logger.debug(
        'Skipping contract-summary enqueue (session is not canonical)',
        {
          eventId,
          sessionId,
          canonicalSessionId: contract.sessionId ?? null,
          contractId: contract.contractId,
        }
      );
    } else {
      const now = new Date().toISOString();
      const eventObject = (
        payload as { object?: { created?: unknown; epoch?: unknown } }
      ).object;
      const sourceUpdatedAt = normalizeSourceUpdatedAt(
        eventObject?.created,
        contract.updatedAt ?? now
      );
      const sourceEpoch =
        typeof eventObject?.epoch === 'number' &&
        Number.isFinite(eventObject.epoch)
          ? eventObject.epoch
          : undefined;
      const snapshot = buildContractSummaryInputSnapshot({
        contractId: contract.contractId,
        sourceUpdatedAt,
        sourceEpoch,
        eventId,
        contractSnapshot: toCompactContractSnapshot(contract),
        createdAt: now,
      });

      await summaryInputStore.save(snapshot);

      const enqueued = await enqueueContractSummaryJob(
        {
          type: 'contract-summary',
          messageVersion: 1,
          contractId: contract.contractId,
          documentId: contract.documentId ?? contract.contractId,
          summaryInputKey: snapshot.summaryInputKey,
          sourceUpdatedAt,
          ...(sourceEpoch !== undefined ? { sourceEpoch } : {}),
          reason: 'webhook',
        },
        logger
      );
      if (!enqueued) {
        logger.error('Contract summary enqueue failed', {
          eventId,
          sessionId,
          contractId: contract.contractId,
          documentId: contract.documentId ?? contract.contractId,
          summaryInputKey: snapshot.summaryInputKey,
        });
      }
    }
  }

  return {
    status: 200 as const,
    body: note
      ? ({ status: 'ok' as const, note } as const)
      : ({ status: 'ok' as const } as const),
  };
};
