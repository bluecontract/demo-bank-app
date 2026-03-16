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
  getCardTransactionDetailsFromDocument,
  getPayloadSummary,
  readEventObjectDocumentId,
  readFetchedDocumentId,
  toCompactBlueJsonValue,
} from '@demo-bank-app/paynotes';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Blue } from '@blue-labs/language';
import { repository } from '@blue-repository/types';
import { DocumentBootstrapRequestedSchema } from '@blue-repository/types/packages/conversation/schemas';
import { DocumentSessionBootstrapSchema } from '@blue-repository/types/packages/myos/schemas';
import {
  PayNoteDeliverySchema,
  PaymentMandateSchema,
  PayNoteSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import {
  createResolveMerchantNameById,
  createResolveMerchantOwnerUserId,
  getDependencies,
} from './dependencies';
import type { ContractRecord } from '@demo-bank-app/contracts';
import type {
  ContractSummaryJob,
  PayNoteDeliverySummaryJob,
} from '../summary/types';
import {
  buildContractSummaryInputSnapshot,
  normalizeSourceUpdatedAt,
} from '../summary/inputStore';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';
import { createDefaultMergingProcessor } from '@blue-labs/document-processor';

const blue = new Blue({
  repositories: [repository],
  mergingProcessor: createDefaultMergingProcessor(),
});

const UNKNOWN_SESSION_RETRY_ATTEMPTS = 3;
const UNKNOWN_SESSION_RETRY_DELAY_MS = 2_000;

type RuntimeDependencies = Awaited<ReturnType<typeof getDependencies>>;
type RuntimeMyOsClient = RuntimeDependencies['myOsClient'];
type RuntimePayNoteRepository = RuntimeDependencies['payNoteRepository'];
type RuntimePayNoteDeliveryRepository =
  RuntimeDependencies['payNoteDeliveryRepository'];
type RuntimePayNoteBootstrapRepository =
  RuntimeDependencies['payNoteBootstrapRepository'];
type RuntimeBootstrapContextRepository =
  RuntimeDependencies['bootstrapContextRepository'];
type RuntimePendingBootstrapEventRepository =
  RuntimeDependencies['pendingBootstrapEventRepository'];
type RuntimeContractRepository = RuntimeDependencies['contractRepository'];
type RuntimeHoldRepository = RuntimeDependencies['holdRepository'];
type RuntimeClock = RuntimeDependencies['clock'];

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

const resolveSummaryJobSourceEpoch = (input: {
  eventType?: string;
  eventObject?: { epoch?: unknown };
}): number | undefined => {
  const epoch = input.eventObject?.epoch;
  if (typeof epoch === 'number' && Number.isFinite(epoch)) {
    return epoch;
  }

  // DOCUMENT_CREATED is chronologically before epoch 0 but MyOS does not attach
  // object.epoch to that webhook. Treat it as synthetic epoch -1 so stale
  // summary jobs can be dropped deterministically when epoch 0+ has already won.
  if (input.eventType === 'DOCUMENT_CREATED') {
    return -1;
  }

  return undefined;
};

const classifyDocumentType = (
  document: unknown,
  supportedContract?: ReturnType<typeof getSupportedContractForDocument> | null
) => {
  try {
    const node = blue.jsonValueToNode(document);
    const resolvedContract =
      supportedContract ?? getSupportedContractForDocument(document);
    const resolvedTypeName = resolvedContract?.typeName;
    return {
      isPayNote:
        resolvedTypeName === 'PayNote/PayNote' ||
        resolvedTypeName === 'PayNote/Payment Mandate' ||
        blue.isTypeOf(node, PayNoteSchema, {
          checkSchemaExtensions: true,
        }) ||
        blue.isTypeOf(node, PaymentMandateSchema, {
          checkSchemaExtensions: true,
        }),
      isPaymentMandate:
        resolvedTypeName === 'PayNote/Payment Mandate' ||
        blue.isTypeOf(node, PaymentMandateSchema, {
          checkSchemaExtensions: true,
        }),
      isDelivery:
        resolvedTypeName === 'PayNote/PayNote Delivery' ||
        blue.isTypeOf(node, PayNoteDeliverySchema, {
          checkSchemaExtensions: true,
        }),
      isBootstrap: blue.isTypeOf(node, DocumentSessionBootstrapSchema, {
        checkSchemaExtensions: true,
      }),
      isSupportedContract: Boolean(resolvedContract),
    };
  } catch {
    return {
      isPayNote: false,
      isPaymentMandate: false,
      isDelivery: false,
      isBootstrap: false,
      isSupportedContract: false,
    };
  }
};

const getStringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const wrapped = (value as { value?: unknown }).value;
  return typeof wrapped === 'string' && wrapped.length > 0
    ? wrapped
    : undefined;
};

const getRecordValue = (
  value: unknown
): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const extractDocumentBootstrapRequestFromEvent = (
  event: unknown
): Record<string, unknown> | null => {
  const rawRecord = getRecordValue(event);
  const rawDocument = getRecordValue(rawRecord?.document);

  let simpleRecord: Record<string, unknown> | undefined;
  let node: ReturnType<typeof blue.jsonValueToNode> | undefined;
  try {
    node = blue.jsonValueToNode(event);
    simpleRecord = getRecordValue(blue.nodeToJson(node, 'simple'));
  } catch {
    simpleRecord = rawRecord;
  }

  if (!simpleRecord) {
    return null;
  }

  if (
    !node ||
    !blue.isTypeOf(node, DocumentBootstrapRequestedSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return null;
  }

  if (!rawDocument && !getRecordValue(simpleRecord.document)) {
    return null;
  }

  return simpleRecord;
};

const hasDocumentBootstrapRequest = (payload: unknown): boolean => {
  const emitted = (payload as { object?: { emitted?: unknown[] } })?.object
    ?.emitted;
  const document = (payload as { object?: { document?: unknown } })?.object
    ?.document;
  const checkpointLastEvents = getRecordValue(
    getRecordValue(getRecordValue(document)?.checkpoint)?.lastEvents
  );
  const checkpointRequests = checkpointLastEvents
    ? Object.values(checkpointLastEvents)
        .map(entry => getRecordValue(getRecordValue(entry)?.message)?.request)
        .filter((request): request is unknown => request != null)
    : [];
  const candidates = [
    ...(Array.isArray(emitted) ? emitted : []),
    ...checkpointRequests,
  ];
  return candidates.some(event =>
    Boolean(extractDocumentBootstrapRequestFromEvent(event))
  );
};

const getStringArray = (value: unknown): string[] => {
  const recordValue = getRecordValue(value);
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(recordValue?.items)
    ? recordValue.items
    : [];

  return rawItems
    .map(item => getStringValue(item))
    .filter((item): item is string => typeof item === 'string');
};

const getBootstrapDocumentInitiatorSessionIds = (
  document: unknown
): string[] => {
  const record = getRecordValue(document);
  if (!record) {
    return [];
  }
  return Array.from(new Set(getStringArray(record.initiatorSessionIds)));
};

const resolveKnownSupportedContractSession = async (input: {
  sessionId: string;
  payloadObject: unknown;
  myOsClient: RuntimeMyOsClient;
  payNoteRepository?: Pick<RuntimePayNoteRepository, 'getPayNoteBySessionId'>;
  bootstrapContextRepository: RuntimeBootstrapContextRepository;
  contractRepository: RuntimeContractRepository;
}) => {
  const resolveVerifiedContract = async (
    contract:
      | {
          contractId?: unknown;
          sessionId?: unknown;
          documentId?: unknown;
          createdAt?: unknown;
        }
      | null
      | undefined,
    fallbackDocumentId?: string
  ) => {
    const canonicalSessionId = getStringValue(contract?.sessionId);
    if (!canonicalSessionId) {
      return null;
    }

    const bootstrapSessionId =
      await input.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId?.(
        canonicalSessionId
      );
    if (!bootstrapSessionId) {
      return null;
    }

    const hydratedContract =
      getStringValue(contract?.contractId) &&
      getStringValue(contract?.documentId)
        ? contract
        : await input.contractRepository.getContractBySessionId(
            canonicalSessionId
          );

    const contractId = getStringValue(
      hydratedContract?.contractId ?? contract?.contractId
    );
    const contractDocumentId =
      getStringValue(hydratedContract?.documentId) ??
      getStringValue(contract?.documentId) ??
      fallbackDocumentId;
    const contractCreatedAt = getStringValue(
      hydratedContract?.createdAt ?? contract?.createdAt
    );

    if (!contractDocumentId) {
      return null;
    }

    return {
      bootstrapSessionId,
      canonicalSessionId,
      contractDocumentId,
      contractId,
      contractCreatedAt,
    };
  };

  const resolveByDocumentId = async (contractDocumentId?: string) => {
    if (!contractDocumentId) {
      return null;
    }

    const canonicalContract =
      await input.contractRepository.getContractByDocumentId(
        contractDocumentId
      );
    return resolveVerifiedContract(canonicalContract, contractDocumentId);
  };

  const knownContractBySession =
    await input.contractRepository.getContractBySessionId(input.sessionId);
  const resolvedBySession = await resolveVerifiedContract(
    knownContractBySession
  );
  if (resolvedBySession) {
    return resolvedBySession;
  }

  const contractDocumentIds = new Set<string>();
  const knownPayNote = input.payNoteRepository
    ? await input.payNoteRepository.getPayNoteBySessionId(input.sessionId)
    : null;
  const existingDocumentId = getStringValue(knownPayNote?.payNoteDocumentId);
  if (existingDocumentId) {
    contractDocumentIds.add(existingDocumentId);
  }

  const eventDocumentId = readEventObjectDocumentId(input.payloadObject);
  if (eventDocumentId) {
    contractDocumentIds.add(eventDocumentId);
  }

  for (const contractDocumentId of contractDocumentIds) {
    const resolved = await resolveByDocumentId(contractDocumentId);
    if (resolved) {
      return resolved;
    }
  }

  const fetchedDocument = await input.myOsClient.fetchDocument(input.sessionId);
  if (fetchedDocument.kind !== 'success') {
    return null;
  }

  return resolveByDocumentId(
    readFetchedDocumentId(fetchedDocument.document) ??
      getStringValue(fetchedDocument.document.documentId)
  );
};

const persistVerifiedTargetSessionBootstrapLink = async (input: {
  sessionId: string;
  knownSession: NonNullable<
    Awaited<ReturnType<typeof resolveKnownSupportedContractSession>>
  >;
  bootstrapContextRepository: {
    saveTargetSessionBootstrapLink?: (input: {
      targetSessionId: string;
      bootstrapSessionId: string;
      createdAt: string;
    }) => Promise<void>;
  };
  createdAt: string;
}) => {
  const { sessionId, knownSession, bootstrapContextRepository, createdAt } =
    input;
  if (
    sessionId === knownSession.canonicalSessionId ||
    typeof bootstrapContextRepository.saveTargetSessionBootstrapLink !==
      'function'
  ) {
    return;
  }

  await bootstrapContextRepository.saveTargetSessionBootstrapLink({
    targetSessionId: sessionId,
    bootstrapSessionId: knownSession.bootstrapSessionId,
    createdAt: knownSession.contractCreatedAt ?? createdAt,
  });
};

const isKnownSupportedContractSession = (
  value: Awaited<ReturnType<typeof resolveKnownSupportedContractSession>>
): value is NonNullable<
  Awaited<ReturnType<typeof resolveKnownSupportedContractSession>>
> => value !== null;

const resolveDocumentName = (document: unknown): string | undefined => {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return undefined;
  }
  const record = document as Record<string, unknown>;
  const directName = getStringValue(record.name);
  if (directName) {
    return directName;
  }
  try {
    const node = blue.jsonValueToNode(document);
    const simple = blue.nodeToJson(node, 'simple') as
      | Record<string, unknown>
      | undefined;
    return getStringValue(simple?.name);
  } catch {
    return undefined;
  }
};

const isSynchronyMerchantDocument = (document: unknown): boolean =>
  resolveDocumentName(document) === 'Synchrony Merchant';

const sleep = async (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

const resolveSessionBootstrapContexts = async (
  bootstrapContextRepository: {
    getContextBySessionId: (sessionId: string) => Promise<unknown | null>;
    getBootstrapSessionIdByTargetSessionId?: (
      targetSessionId: string
    ) => Promise<string | null>;
  },
  sessionId: string
) => {
  const directBootstrapContext =
    await bootstrapContextRepository.getContextBySessionId(sessionId);
  const linkedBootstrapSessionId =
    await bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId?.(
      sessionId
    );
  const linkedBootstrapContext = linkedBootstrapSessionId
    ? await bootstrapContextRepository.getContextBySessionId(
        linkedBootstrapSessionId
      )
    : null;

  return {
    directBootstrapContext,
    linkedBootstrapContext,
    linkedBootstrapSessionId,
  };
};

const resolveBootstrapSessionCandidateFromKnownDelivery = async (input: {
  document: unknown;
  bootstrapContextRepository: RuntimeBootstrapContextRepository;
  payNoteDeliveryRepository: Pick<
    RuntimePayNoteDeliveryRepository,
    'getDeliveryByCardTransactionDetails'
  >;
}) => {
  const cardDetails = getCardTransactionDetailsFromDocument(input.document);
  if (!cardDetails) {
    return null;
  }

  const delivery =
    await input.payNoteDeliveryRepository.getDeliveryByCardTransactionDetails(
      cardDetails
    );
  const bootstrapSessionId = getStringValue(
    delivery?.payNoteBootstrapSessionId
  );
  if (!bootstrapSessionId) {
    return null;
  }

  const bootstrapContext =
    await input.bootstrapContextRepository.getContextBySessionId(
      bootstrapSessionId
    );
  if (!bootstrapContext) {
    return null;
  }

  return {
    bootstrapSessionId,
    deliveryId: getStringValue(delivery?.deliveryId),
  };
};

const isKnownBootstrapSessionCandidate = <
  T extends { bootstrapSessionId: string }
>(
  value: T | null
): value is T => value !== null;

const consumeBootstrapSessionCandidate = async (input: {
  eventId: string | undefined;
  sessionId: string;
  document: unknown;
  source: 'delivery' | 'payment-mandate';
  candidate: {
    bootstrapSessionId: string;
    deliveryId?: string;
    contractSessionId?: string;
  };
  logger: PowertoolsLogger;
  bootstrapContextRepository: RuntimeBootstrapContextRepository;
  myOsClient: RuntimeMyOsClient;
  payNoteRepository: RuntimePayNoteRepository;
  payNoteDeliveryRepository: RuntimePayNoteDeliveryRepository;
  payNoteBootstrapRepository: RuntimePayNoteBootstrapRepository;
  pendingBootstrapEventRepository: RuntimePendingBootstrapEventRepository;
  contractRepository: RuntimeContractRepository;
  holdRepository: RuntimeHoldRepository;
  clock: RuntimeClock;
  logHandlerResult: (
    result: {
      logs: Array<{
        level: string;
        message: string;
        context?: Record<string, unknown>;
      }>;
    } | null,
    skippedMessage: string
  ) => void;
}) => {
  const {
    eventId,
    sessionId,
    document,
    source,
    candidate,
    logger,
    bootstrapContextRepository,
    myOsClient,
    payNoteRepository,
    payNoteDeliveryRepository,
    payNoteBootstrapRepository,
    pendingBootstrapEventRepository,
    contractRepository,
    holdRepository,
    clock,
    logHandlerResult,
  } = input;

  const hydrateBootstrapSessionFromMyOs = async () => {
    const bootstrapDocumentResult = await myOsClient.fetchDocument(
      candidate.bootstrapSessionId
    );
    if (bootstrapDocumentResult.kind !== 'success') {
      logger.debug('Bootstrap session hydration from MyOS skipped', {
        eventId,
        sessionId,
        source,
        bootstrapSessionId: candidate.bootstrapSessionId,
        deliveryId: candidate.deliveryId ?? null,
        contractSessionId: candidate.contractSessionId ?? null,
        fetchKind: bootstrapDocumentResult.kind,
        fetchStatus:
          'status' in bootstrapDocumentResult
            ? bootstrapDocumentResult.status
            : undefined,
      });
      return resolveSessionBootstrapContexts(
        bootstrapContextRepository,
        sessionId
      );
    }

    const bootstrapPayload = bootstrapDocumentResult.document.document;
    if (!bootstrapPayload) {
      logger.debug(
        'Bootstrap session hydration from MyOS skipped (missing document payload)',
        {
          eventId,
          sessionId,
          source,
          bootstrapSessionId: candidate.bootstrapSessionId,
          deliveryId: candidate.deliveryId ?? null,
          contractSessionId: candidate.contractSessionId ?? null,
        }
      );
      return resolveSessionBootstrapContexts(
        bootstrapContextRepository,
        sessionId
      );
    }

    const syntheticEventId = [
      'bootstrap-sync',
      candidate.bootstrapSessionId,
      sessionId,
      eventId ?? 'unknown-event',
    ].join(':');

    const hydrateResult = await handlePayNoteBootstrapWebhookEvent(
      {
        eventId: syntheticEventId,
        payload: {
          id: syntheticEventId,
          ref: candidate.bootstrapSessionId,
          object: {
            sessionId: candidate.bootstrapSessionId,
            document: bootstrapPayload,
          },
        },
        skipEventIdempotencyClaim: true,
        skipPendingBuffer: true,
        skipExternalReporting: true,
      },
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
    logHandlerResult(
      hydrateResult,
      'Bootstrap session hydration from MyOS produced no logs'
    );

    const resolvedContexts = await resolveSessionBootstrapContexts(
      bootstrapContextRepository,
      sessionId
    );
    if (
      resolvedContexts.directBootstrapContext ||
      resolvedContexts.linkedBootstrapContext
    ) {
      logger.info(
        'Resolved webhook session after hydrating bootstrap session',
        {
          eventId,
          sessionId,
          source,
          bootstrapSessionId: candidate.bootstrapSessionId,
          deliveryId: candidate.deliveryId ?? null,
          contractSessionId: candidate.contractSessionId ?? null,
          linkedBootstrapSessionId:
            resolvedContexts.linkedBootstrapSessionId ?? null,
        }
      );
      return resolvedContexts;
    }

    const bootstrapTargetSessionIds =
      getBootstrapDocumentInitiatorSessionIds(bootstrapPayload);
    const canPersistVerifiedAlias =
      bootstrapTargetSessionIds.length > 0 &&
      typeof bootstrapContextRepository.saveTargetSessionBootstrapLink ===
        'function' &&
      source === 'delivery' &&
      Boolean(getCardTransactionDetailsFromDocument(document));

    if (!canPersistVerifiedAlias) {
      return resolvedContexts;
    }

    const bootstrapContext =
      await bootstrapContextRepository.getContextBySessionId(
        candidate.bootstrapSessionId
      );
    const createdAt =
      getStringValue(
        (bootstrapContext as { createdAt?: unknown } | null | undefined)
          ?.createdAt
      ) ?? clock.now().toISOString();

    await bootstrapContextRepository.saveTargetSessionBootstrapLink?.({
      targetSessionId: sessionId,
      bootstrapSessionId: candidate.bootstrapSessionId,
      createdAt,
    });

    const resolvedAliasContexts = await resolveSessionBootstrapContexts(
      bootstrapContextRepository,
      sessionId
    );
    if (
      resolvedAliasContexts.directBootstrapContext ||
      resolvedAliasContexts.linkedBootstrapContext
    ) {
      logger.info(
        'Resolved webhook session via verified bootstrap candidate alias',
        {
          eventId,
          sessionId,
          source,
          bootstrapSessionId: candidate.bootstrapSessionId,
          deliveryId: candidate.deliveryId ?? null,
          contractSessionId: candidate.contractSessionId ?? null,
          linkedBootstrapSessionId:
            resolvedAliasContexts.linkedBootstrapSessionId ?? null,
        }
      );
    }

    return resolvedAliasContexts;
  };

  const consumeResult = await consumePendingPayNoteBootstrapEvents(
    { bootstrapSessionId: candidate.bootstrapSessionId },
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

  let resolvedContexts = await resolveSessionBootstrapContexts(
    bootstrapContextRepository,
    sessionId
  );
  if (
    resolvedContexts.directBootstrapContext ||
    resolvedContexts.linkedBootstrapContext
  ) {
    logger.info(
      'Resolved webhook session after consuming pending bootstrap events',
      {
        eventId,
        sessionId,
        source,
        bootstrapSessionId: candidate.bootstrapSessionId,
        deliveryId: candidate.deliveryId ?? null,
        contractSessionId: candidate.contractSessionId ?? null,
        linkedBootstrapSessionId:
          resolvedContexts.linkedBootstrapSessionId ?? null,
      }
    );
  }

  if (
    !resolvedContexts.directBootstrapContext &&
    !resolvedContexts.linkedBootstrapContext
  ) {
    resolvedContexts = await hydrateBootstrapSessionFromMyOs();
  }

  return resolvedContexts;
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
    merchantDirectoryRepository,
    clock,
  } = await getDependencies();
  const resolveMerchantOwnerUserId = createResolveMerchantOwnerUserId(
    merchantDirectoryRepository
  );
  const resolveMerchantNameById = createResolveMerchantNameById(
    merchantDirectoryRepository
  );

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
        isPaymentMandate: false,
        isDelivery: false,
        isBootstrap: false,
        isSupportedContract: false,
      };

  const hasBootstrapRequest = hasDocumentBootstrapRequest(payload);
  const shouldHandleDelivery = documentType.isDelivery || hasBootstrapRequest;
  const shouldDelayDeliveryHandling =
    hasBootstrapRequest && documentType.isPayNote && !documentType.isDelivery;

  const payloadSessionId = (payload as { object?: { sessionId?: unknown } })
    ?.object?.sessionId;
  const sessionId =
    typeof payloadSessionId === 'string' ? payloadSessionId : undefined;
  const shouldSkipSessionGate =
    !documentPayload ||
    isSynchronyMerchantDocument(documentPayload) ||
    documentType.isBootstrap ||
    documentType.isDelivery;

  if (sessionId && !shouldSkipSessionGate) {
    let {
      directBootstrapContext,
      linkedBootstrapContext,
      linkedBootstrapSessionId,
    } = await resolveSessionBootstrapContexts(
      bootstrapContextRepository,
      sessionId
    );

    if (!directBootstrapContext && !linkedBootstrapContext) {
      for (
        let attempt = 1;
        attempt <= UNKNOWN_SESSION_RETRY_ATTEMPTS;
        attempt += 1
      ) {
        logger.debug(
          'Bootstrap context missing for webhook session, retrying session gate',
          {
            eventId,
            sessionId,
            attempt,
            maxAttempts: UNKNOWN_SESSION_RETRY_ATTEMPTS,
            delayMs: UNKNOWN_SESSION_RETRY_DELAY_MS,
          }
        );
        await sleep(UNKNOWN_SESSION_RETRY_DELAY_MS);
        ({
          directBootstrapContext,
          linkedBootstrapContext,
          linkedBootstrapSessionId,
        } = await resolveSessionBootstrapContexts(
          bootstrapContextRepository,
          sessionId
        ));
        if (directBootstrapContext || linkedBootstrapContext) {
          logger.debug('Bootstrap context resolved after retry', {
            eventId,
            sessionId,
            attempt,
            linkedBootstrapSessionId: linkedBootstrapSessionId ?? null,
          });
          break;
        }
      }
    }

    if (!directBootstrapContext && !linkedBootstrapContext) {
      const knownDeliveryBootstrapCandidate =
        documentType.isPayNote && documentPayload
          ? await resolveBootstrapSessionCandidateFromKnownDelivery({
              document: documentPayload,
              bootstrapContextRepository,
              payNoteDeliveryRepository,
            })
          : null;
      if (isKnownBootstrapSessionCandidate(knownDeliveryBootstrapCandidate)) {
        ({
          directBootstrapContext,
          linkedBootstrapContext,
          linkedBootstrapSessionId,
        } = await consumeBootstrapSessionCandidate({
          eventId,
          sessionId,
          document: documentPayload,
          source: 'delivery',
          candidate: knownDeliveryBootstrapCandidate,
          logger,
          bootstrapContextRepository,
          myOsClient,
          payNoteRepository,
          payNoteDeliveryRepository,
          payNoteBootstrapRepository,
          pendingBootstrapEventRepository,
          contractRepository,
          holdRepository,
          clock,
          logHandlerResult,
        }));
      }
    }

    if (!directBootstrapContext && !linkedBootstrapContext) {
      const knownSupportedContractSession = documentType.isSupportedContract
        ? await resolveKnownSupportedContractSession({
            sessionId,
            payloadObject: (payload as { object?: unknown }).object,
            myOsClient,
            ...(documentType.isPayNote ? { payNoteRepository } : {}),
            bootstrapContextRepository,
            contractRepository,
          })
        : null;
      if (isKnownSupportedContractSession(knownSupportedContractSession)) {
        await persistVerifiedTargetSessionBootstrapLink({
          sessionId,
          knownSession: knownSupportedContractSession,
          bootstrapContextRepository,
          createdAt: clock.now().toISOString(),
        });
        logger.info(
          'Allowing supported contract webhook session via canonical bootstrap verification',
          {
            eventId,
            sessionId,
            documentName: resolveDocumentName(documentPayload) ?? null,
            canonicalSessionId:
              knownSupportedContractSession.canonicalSessionId,
            bootstrapSessionId:
              knownSupportedContractSession.bootstrapSessionId,
            contractDocumentId:
              knownSupportedContractSession.contractDocumentId,
          }
        );
      } else {
        logger.warn('Rejected webhook for unknown bootstrap/target session', {
          eventId,
          sessionId,
          documentName: resolveDocumentName(documentPayload) ?? null,
          linkedBootstrapSessionId: linkedBootstrapSessionId ?? null,
        });
        throw new Error(
          `Unknown webhook session "${sessionId}" (no bootstrap context mapping)`
        );
      }
    }
  }

  trace('PayNote webhook classification', {
    eventId,
    documentType,
    supportedContractType: supportedContract?.typeName ?? null,
    shouldHandleDelivery,
    shouldDelayDeliveryHandling,
    payloadType: getEventTypeName(payload),
    documentTypeName: documentPayload
      ? getEventTypeName(documentPayload)
      : undefined,
    sessionId,
    emittedCount: Array.isArray(
      (payload as { object?: { emitted?: unknown[] } })?.object?.emitted
    )
      ? (payload as { object?: { emitted?: unknown[] } })?.object?.emitted
          ?.length
      : 0,
  });

  const deliveryResult =
    shouldHandleDelivery && !shouldDelayDeliveryHandling
      ? await handlePayNoteDeliveryWebhookEvent(
          { eventId, payload },
          {
            myOsClient,
            payNoteDeliveryRepository,
            contractRepository,
            bankingRepository,
            holdRepository,
            bootstrapContextRepository,
            resolveMerchantOwnerUserId,
            resolveMerchantNameById,
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
          resolveMerchantNameById,
        }
      )
    : null;

  logHandlerResult(payNoteResult, 'PayNote handler skipped');

  const delayedDeliveryResult = shouldDelayDeliveryHandling
    ? await handlePayNoteDeliveryWebhookEvent(
        { eventId, payload },
        {
          myOsClient,
          payNoteDeliveryRepository,
          contractRepository,
          bankingRepository,
          holdRepository,
          bootstrapContextRepository,
          resolveMerchantOwnerUserId,
          resolveMerchantNameById,
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

  logHandlerResult(
    delayedDeliveryResult,
    'Delayed PayNote delivery handler skipped'
  );

  const note =
    payNoteResult?.note ??
    bootstrapResult?.note ??
    delayedDeliveryResult?.note ??
    deliveryResult?.note;

  if (sessionId && documentType.isSupportedContract) {
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
      const marked = await contractRepository.markSummaryEventProcessed(
        eventId
      );
      if (!marked) {
        logger.debug(
          'Skipping contract-summary enqueue (event already processed)',
          {
            eventId,
            sessionId,
            contractId: contract.contractId,
            canonicalSessionId: contract.sessionId ?? null,
          }
        );
        return {
          status: 200 as const,
          body: note
            ? ({ status: 'ok' as const, note } as const)
            : ({ status: 'ok' as const } as const),
        };
      }

      const now = new Date().toISOString();
      const eventObject = (
        payload as { object?: { created?: unknown; epoch?: unknown } }
      ).object;
      const sourceUpdatedAt = normalizeSourceUpdatedAt(
        eventObject?.created,
        contract.updatedAt ?? now
      );
      const sourceEpoch = resolveSummaryJobSourceEpoch({
        eventType: getEventTypeName(payload),
        eventObject,
      });
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
