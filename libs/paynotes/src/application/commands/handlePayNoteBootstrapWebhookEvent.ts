import {
  DocumentSessionBootstrapSchema,
  TargetDocumentSessionStartedSchema,
} from '@blue-repository/types/packages/myos/schemas';
import { PaymentMandateSchema } from '@blue-repository/types/packages/paynote/schemas';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import type {
  BootstrapContextRepository,
  ClockPort,
  LogEntry,
  MyOsClient,
  PendingBootstrapEventRepository,
  PayNoteBootstrapRepository,
  PayNoteDeliveryRecord,
  PayNoteDeliveryRepository,
  PayNoteRepository,
  PayNoteRecord,
} from '../ports';
import type { HoldRepository } from '@demo-bank-app/banking';
import type { ContractRepository } from '@demo-bank-app/contracts';
import { blue } from '../../blue';
import { isPayNoteDocument } from '../payNoteDelivery/blueUtils';
import { runGuarantorUpdate } from './documentOperations';
import { upsertPayNoteContractRecord } from './payNoteContractUtils';
import { updateHoldPayNoteDocumentId } from './payNoteHoldUtils';
import { mergeSessionIds } from './payNoteSessionUtils';
import { log, trace } from './paynoteWebhook/logging';
import { logMyOsFetchError } from './paynoteWebhook/myosErrors';
import { getPayloadSummary, toBlueNode } from './webhookUtils';
import { upsertContractRecord } from '../contracts';

export interface HandlePayNoteBootstrapWebhookInput {
  payload: unknown;
  eventId?: string;
  skipEventIdempotencyClaim?: boolean;
  skipPendingBuffer?: boolean;
}

export interface HandlePayNoteBootstrapWebhookDependencies {
  myOsClient: MyOsClient;
  payNoteRepository: PayNoteRepository;
  payNoteDeliveryRepository: PayNoteDeliveryRepository;
  payNoteBootstrapRepository: PayNoteBootstrapRepository;
  bootstrapContextRepository: BootstrapContextRepository;
  pendingBootstrapEventRepository: PendingBootstrapEventRepository;
  contractRepository: ContractRepository;
  holdRepository: HoldRepository;
  clock: ClockPort;
}

export interface HandlePayNoteBootstrapWebhookResult {
  handled: boolean;
  note?: string;
  logs: LogEntry[];
}

export interface ConsumePendingPayNoteBootstrapEventsInput {
  bootstrapSessionId: string;
}

export interface ConsumePendingPayNoteBootstrapEventsResult {
  handled: boolean;
  consumedCount: number;
  remainingCount: number;
  logs: LogEntry[];
}

const updateHoldPayNoteDocumentIdForBootstrap = async (
  logs: LogEntry[],
  holdId: string,
  payNoteDocumentId: string,
  deps: HandlePayNoteBootstrapWebhookDependencies,
  context?: { eventId?: string; deliveryId?: string }
) => {
  if (!payNoteDocumentId) {
    return;
  }
  const hold = await deps.holdRepository.getHold(holdId);
  if (!hold) {
    trace(logs, 'Hold missing while linking PayNote document', {
      eventId: context?.eventId,
      deliveryId: context?.deliveryId,
      holdId,
    });
    return;
  }
  await updateHoldPayNoteDocumentId({
    logs,
    hold,
    holdRepository: deps.holdRepository,
    payNoteDocumentId,
    context,
    message: 'Hold PayNote reference updated after bootstrap',
  });
};

const withInResponseTo = (
  event: Record<string, unknown>,
  requestId: string | undefined
): Record<string, unknown> => {
  if (!requestId) {
    return event;
  }
  return {
    ...event,
    inResponseTo: {
      requestId,
    },
  };
};

const supportsGuarantorUpdateResponses = (document: unknown): boolean => {
  if (isPayNoteDocument(document)) {
    return true;
  }

  const node = toBlueNode(document);
  if (!node) {
    return false;
  }
  const original = blue.nodeToJson(node, 'original');
  if (!original || typeof original !== 'object' || Array.isArray(original)) {
    return false;
  }

  const contracts = (original as { contracts?: unknown }).contracts;
  if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) {
    return false;
  }

  const contractsRecord = contracts as Record<string, unknown>;
  return Boolean(
    contractsRecord.guarantorUpdate && contractsRecord.guarantorChannel
  );
};

const supportsGuarantorUpdateByContractType = async (input: {
  deps: HandlePayNoteBootstrapWebhookDependencies;
  requestingSessionId: string;
}): Promise<boolean | null> => {
  const contract = await input.deps.contractRepository.getContractBySessionId(
    input.requestingSessionId
  );
  if (!contract) {
    return null;
  }

  if (contract.typeBlueId === paynoteBlueIds['PayNote/PayNote']) {
    return true;
  }

  if (contract.typeBlueId === paynoteBlueIds['PayNote/Payment Mandate']) {
    return true;
  }

  if (contract.typeBlueId === paynoteBlueIds['PayNote/PayNote Delivery']) {
    return false;
  }

  return null;
};

const reportBootstrapCompleted = async (input: {
  eventId: string;
  bootstrapSessionId?: string;
  documentId: string;
  requestingSessionId?: string;
  requestId?: string;
  deps: HandlePayNoteBootstrapWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const {
    eventId,
    bootstrapSessionId,
    documentId,
    requestingSessionId,
    requestId,
    deps,
    logs,
  } = input;

  if (!requestingSessionId) {
    return false;
  }

  const supportsByContractType = await supportsGuarantorUpdateByContractType({
    deps,
    requestingSessionId,
  });
  if (supportsByContractType === false) {
    log(
      logs,
      'info',
      'Skipped bootstrap completion guarantorUpdate for requester without guarantorUpdate contract',
      {
        eventId,
        bootstrapSessionId: bootstrapSessionId ?? null,
        requestingSessionId,
        documentId,
      }
    );
    return true;
  }

  if (supportsByContractType === true) {
    const credentials = await deps.myOsClient.getCredentials();
    return runGuarantorUpdate({
      myOsClient: deps.myOsClient,
      credentials,
      sessionId: requestingSessionId,
      request: [
        withInResponseTo(
          {
            type: 'Conversation/Document Bootstrap Completed',
            documentId,
          },
          requestId
        ),
      ],
      logs,
      logContext: {
        eventId,
        bootstrapSessionId: bootstrapSessionId ?? null,
        requestId: requestId ?? null,
        requestingSessionId,
        documentId,
      },
      successMessage:
        'Reported document bootstrap completion via guarantorUpdate',
      failureMessage:
        'Failed to report document bootstrap completion via guarantorUpdate',
      missingCredentialsMessage:
        'Skipped document bootstrap completion (missing MyOS credentials)',
    });
  }

  const requestingDocument = await deps.myOsClient.fetchDocument(
    requestingSessionId
  );
  if (requestingDocument.kind !== 'success') {
    log(
      logs,
      'warn',
      'Skipped bootstrap completion guarantorUpdate (requesting document unavailable)',
      {
        eventId,
        bootstrapSessionId: bootstrapSessionId ?? null,
        requestingSessionId,
        documentId,
        fetchKind: requestingDocument.kind,
        fetchStatus:
          'status' in requestingDocument
            ? requestingDocument.status
            : undefined,
      }
    );
    return true;
  }

  const requesterDocumentPayload = requestingDocument.document.document;
  if (!supportsGuarantorUpdateResponses(requesterDocumentPayload)) {
    log(
      logs,
      'info',
      'Skipped bootstrap completion guarantorUpdate for requester without guarantorUpdate contract',
      {
        eventId,
        bootstrapSessionId: bootstrapSessionId ?? null,
        requestingSessionId,
        documentId,
      }
    );
    return true;
  }

  const credentials = await deps.myOsClient.getCredentials();
  return runGuarantorUpdate({
    myOsClient: deps.myOsClient,
    credentials,
    sessionId: requestingSessionId,
    request: [
      withInResponseTo(
        {
          type: 'Conversation/Document Bootstrap Completed',
          documentId,
        },
        requestId
      ),
    ],
    logs,
    logContext: {
      eventId,
      bootstrapSessionId: bootstrapSessionId ?? null,
      requestId: requestId ?? null,
      requestingSessionId,
      documentId,
    },
    successMessage:
      'Reported document bootstrap completion via guarantorUpdate',
    failureMessage:
      'Failed to report document bootstrap completion via guarantorUpdate',
    missingCredentialsMessage:
      'Skipped document bootstrap completion (missing MyOS credentials)',
  });
};

const reportPaymentMandateAttached = async (input: {
  eventId: string;
  bootstrapSessionId?: string;
  payNoteSessionId: string;
  paymentMandateDocumentId: string;
  deps: HandlePayNoteBootstrapWebhookDependencies;
  logs: LogEntry[];
}): Promise<boolean> => {
  const {
    eventId,
    bootstrapSessionId,
    payNoteSessionId,
    paymentMandateDocumentId,
    deps,
    logs,
  } = input;

  const credentials = await deps.myOsClient.getCredentials();
  return runGuarantorUpdate({
    myOsClient: deps.myOsClient,
    credentials,
    sessionId: payNoteSessionId,
    request: [
      {
        type: 'PayNote/Payment Mandate Attached',
        paymentMandateDocumentId,
      },
    ],
    logs,
    logContext: {
      eventId,
      bootstrapSessionId: bootstrapSessionId ?? null,
      payNoteSessionId,
      paymentMandateDocumentId,
    },
    successMessage: 'Reported payment mandate attachment via guarantorUpdate',
    failureMessage:
      'Failed to report payment mandate attachment via guarantorUpdate',
    missingCredentialsMessage:
      'Skipped payment mandate attachment update (missing MyOS credentials)',
  });
};

const reportDeliveryMandateAttachmentToPayNotes = async (input: {
  eventId: string;
  bootstrapSessionId?: string;
  deliveryRecord: PayNoteDeliveryRecord | null;
  payNoteSessionIdHint?: string;
  deps: HandlePayNoteBootstrapWebhookDependencies;
  logs: LogEntry[];
  reportedSessionIds: Set<string>;
}): Promise<void> => {
  const {
    eventId,
    bootstrapSessionId,
    deliveryRecord,
    payNoteSessionIdHint,
    deps,
    logs,
    reportedSessionIds,
  } = input;

  if (
    !deliveryRecord ||
    deliveryRecord.paymentMandateStatus !== 'attached' ||
    !deliveryRecord.paymentMandateDocumentId
  ) {
    return;
  }

  let candidateSessionIds = mergeSessionIds(
    deliveryRecord.payNoteSessionIds,
    payNoteSessionIdHint
  );

  if (deliveryRecord.payNoteDocumentId) {
    const [payNoteRecord, contract] = await Promise.all([
      deps.payNoteRepository.getPayNote(deliveryRecord.payNoteDocumentId),
      deps.contractRepository.getContractByDocumentId(
        deliveryRecord.payNoteDocumentId
      ),
    ]);
    candidateSessionIds = mergeSessionIds(
      candidateSessionIds,
      payNoteRecord?.sessionIds
    );
    candidateSessionIds = mergeSessionIds(
      candidateSessionIds,
      contract?.sessionId
    );
  }

  for (const sessionId of candidateSessionIds ?? []) {
    if (!sessionId || reportedSessionIds.has(sessionId)) {
      continue;
    }
    const reported = await reportPaymentMandateAttached({
      eventId,
      bootstrapSessionId,
      payNoteSessionId: sessionId,
      paymentMandateDocumentId: deliveryRecord.paymentMandateDocumentId,
      deps,
      logs,
    });
    if (reported) {
      reportedSessionIds.add(sessionId);
    }
  }
};

const getTargetSessionIds = (event: unknown): string[] | null => {
  const node = toBlueNode(event);
  if (
    !node ||
    !blue.isTypeOf(node, TargetDocumentSessionStartedSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return null;
  }

  const output = blue.nodeToSchemaOutput(
    node,
    TargetDocumentSessionStartedSchema
  );
  if (output.initiatorSessionIds?.length) {
    return output.initiatorSessionIds.filter(id => id && id.trim().length > 0);
  }

  const simple = blue.nodeToJson(node, 'simple') as
    | Record<string, unknown>
    | undefined;
  const fallbackSingle = simple?.initiatorSessionId;
  if (typeof fallbackSingle === 'string' && fallbackSingle.trim().length > 0) {
    return [fallbackSingle];
  }
  const fallbackArray = simple?.initiatorSessionIds;
  if (Array.isArray(fallbackArray)) {
    const ids = fallbackArray.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
    return ids.length ? ids : [];
  }
  return [];
};

const isDocumentSessionBootstrap = (document: unknown): boolean => {
  const node = toBlueNode(document);
  if (!node) {
    return false;
  }
  return blue.isTypeOf(node, DocumentSessionBootstrapSchema, {
    checkSchemaExtensions: true,
  });
};

const isPaymentMandateDocument = (document: unknown): boolean => {
  const node = toBlueNode(document);
  if (!node) {
    return false;
  }
  return blue.isTypeOf(node, PaymentMandateSchema, {
    checkSchemaExtensions: true,
  });
};

const fetchDocumentMessages = {
  notFound: 'Failed to resolve PayNote document from MyOS',
  httpError: 'Failed to resolve PayNote document from MyOS',
  parseError: 'Failed to parse PayNote document response',
  networkError: 'Unexpected error resolving PayNote document',
};

const fetchEventMessages = {
  notFound: 'Failed to resolve pending bootstrap event from MyOS',
  httpError: 'Failed to resolve pending bootstrap event from MyOS',
  parseError: 'Failed to parse pending bootstrap event response',
  networkError: 'Unexpected error resolving pending bootstrap event',
};

const PENDING_BOOTSTRAP_EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;

const resolvePayNoteDocument = async (
  sessionId: string,
  logs: LogEntry[],
  deps: HandlePayNoteBootstrapWebhookDependencies
): Promise<{
  documentId: string;
  document?: Record<string, unknown>;
} | null> => {
  const result = await deps.myOsClient.fetchDocument(sessionId);
  if (result.kind !== 'success') {
    logMyOsFetchError(result, logs, { sessionId }, fetchDocumentMessages);
    return null;
  }

  return {
    documentId: result.document.documentId,
    document: result.document.document,
  };
};

const mergePayNoteRecord = (
  existing: PayNoteRecord | null,
  updates: Partial<PayNoteRecord> & {
    payNoteDocumentId: string;
    updatedAt: string;
  }
): PayNoteRecord => {
  const createdAt =
    existing?.createdAt ?? updates.createdAt ?? updates.updatedAt;
  return {
    payNoteDocumentId: updates.payNoteDocumentId,
    sessionIds: mergeSessionIds(existing?.sessionIds, updates.sessionIds),
    deliveryId: updates.deliveryId ?? existing?.deliveryId,
    accountNumber: updates.accountNumber ?? existing?.accountNumber,
    userId: updates.userId ?? existing?.userId,
    holdId: updates.holdId ?? existing?.holdId,
    transactionId: updates.transactionId ?? existing?.transactionId,
    merchantId: updates.merchantId ?? existing?.merchantId,
    payerAccountNumber:
      updates.payerAccountNumber ?? existing?.payerAccountNumber,
    payeeAccountNumber:
      updates.payeeAccountNumber ?? existing?.payeeAccountNumber,
    document: updates.document ?? existing?.document,
    transactionRequest: existing?.transactionRequest ?? null,
    triggerEvent: existing?.triggerEvent ?? null,
    createdAt,
    updatedAt: updates.updatedAt,
  };
};

const bufferPendingBootstrapEvent = async (input: {
  eventId: string;
  bootstrapSessionId: string;
  now: string;
  logs: LogEntry[];
  deps: HandlePayNoteBootstrapWebhookDependencies;
}): Promise<void> => {
  const { eventId, bootstrapSessionId, now, logs, deps } = input;
  const ttl =
    Math.floor(new Date(now).getTime() / 1000) +
    PENDING_BOOTSTRAP_EVENT_TTL_SECONDS;

  try {
    await deps.pendingBootstrapEventRepository.addPending({
      bootstrapSessionId,
      eventId,
      createdAt: now,
      ttl,
    });
    log(logs, 'info', 'Buffered bootstrap event (missing context)', {
      eventId,
      bootstrapSessionId,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      trace(logs, 'Bootstrap event already buffered', {
        eventId,
        bootstrapSessionId,
      });
      return;
    }
    throw error;
  }
};

export const handlePayNoteBootstrapWebhookEvent = async (
  input: HandlePayNoteBootstrapWebhookInput,
  deps: HandlePayNoteBootstrapWebhookDependencies
): Promise<HandlePayNoteBootstrapWebhookResult> => {
  const logs: LogEntry[] = [];
  const payload = input.payload as {
    id?: string;
    object?: {
      sessionId?: string;
      document?: unknown;
      emitted?: unknown[];
      created?: string;
    };
  };

  const eventId = input.eventId ?? payload?.id;
  if (!eventId) {
    log(logs, 'warn', 'Webhook payload missing event id', {
      payloadSummary: getPayloadSummary(input.payload),
    });
    return { handled: false, note: 'Missing event id', logs };
  }

  const eventObject = payload?.object;
  const documentPayload = eventObject?.document;

  trace(logs, 'PayNote bootstrap webhook received', {
    eventId,
    sessionId: eventObject?.sessionId,
    hasDocument: Boolean(documentPayload),
    emittedCount: Array.isArray(eventObject?.emitted)
      ? eventObject?.emitted.length
      : 0,
  });

  if (!documentPayload || !isDocumentSessionBootstrap(documentPayload)) {
    trace(logs, 'Bootstrap webhook skipped (not a bootstrap document)', {
      eventId,
      sessionId: eventObject?.sessionId,
    });
    return { handled: false, logs };
  }

  const now = deps.clock.now().toISOString();

  const shouldClaimEvent = !input.skipEventIdempotencyClaim;
  let claimedEvent = false;
  if (shouldClaimEvent) {
    const firstProcess =
      await deps.payNoteDeliveryRepository.markEventProcessed(eventId);
    if (!firstProcess) {
      log(logs, 'info', 'PayNote bootstrap webhook already processed', {
        eventId,
      });
      return { handled: true, logs };
    }
    claimedEvent = true;
  }

  const processBootstrapEvent =
    async (): Promise<HandlePayNoteBootstrapWebhookResult> => {
      const bootstrapSessionId =
        typeof eventObject?.sessionId === 'string'
          ? eventObject.sessionId
          : undefined;

      const emittedEvents = Array.isArray(eventObject?.emitted)
        ? eventObject.emitted
        : undefined;
      const emitted = emittedEvents ?? [];
      const targetEvents = emitted
        .map(event => ({ event, sessionIds: getTargetSessionIds(event) }))
        .filter(
          (item): item is { event: unknown; sessionIds: string[] } =>
            item.sessionIds !== null
        );

      if (!targetEvents.length) {
        log(
          logs,
          'info',
          'No target session events found in bootstrap update',
          {
            eventId,
            bootstrapSessionId,
          }
        );
        return { handled: true, logs };
      }

      if (!bootstrapSessionId) {
        throw new Error(
          'Bootstrap webhook target session event is missing bootstrap session id'
        );
      }

      const deliveryByBootstrapSession = bootstrapSessionId
        ? await deps.payNoteDeliveryRepository.getDeliveryByBootstrapSessionId(
            bootstrapSessionId
          )
        : null;

      const bootstrapRecord = bootstrapSessionId
        ? await deps.payNoteBootstrapRepository.getBootstrapBySessionId(
            bootstrapSessionId
          )
        : null;
      const bootstrapContext = bootstrapSessionId
        ? await deps.bootstrapContextRepository.getContextBySessionId(
            bootstrapSessionId
          )
        : null;
      const hasBootstrapContextLinkingData = Boolean(
        (bootstrapContext?.userId &&
          (bootstrapContext.accountNumber ??
            bootstrapContext.payerAccountNumber ??
            bootstrapContext.payeeAccountNumber)) ||
          bootstrapContext?.requestingSessionId
      );
      const deliveryByRequestingSession = bootstrapContext?.requestingSessionId
        ? await deps.payNoteDeliveryRepository.getDeliveryBySessionId(
            bootstrapContext.requestingSessionId
          )
        : null;
      const deliveryRecord =
        deliveryByBootstrapSession ?? deliveryByRequestingSession;

      if (
        !deliveryRecord &&
        !bootstrapRecord &&
        !hasBootstrapContextLinkingData
      ) {
        log(logs, 'warn', 'Bootstrap event rejected (no matching context)', {
          eventId,
          bootstrapSessionId,
        });
        if (input.skipPendingBuffer) {
          return {
            handled: true,
            note: 'Deferred waiting for bootstrap context',
            logs,
          };
        }
        await bufferPendingBootstrapEvent({
          eventId,
          bootstrapSessionId,
          now,
          logs,
          deps,
        });
        return {
          handled: true,
          note: 'Buffered waiting for bootstrap context',
          logs,
        };
      }

      trace(logs, 'Bootstrap context resolved', {
        eventId,
        bootstrapSessionId,
        hasDeliveryRecord: Boolean(deliveryRecord),
        hasBootstrapRecord: Boolean(bootstrapRecord),
        hasBootstrapContext: Boolean(bootstrapContext),
        hasBootstrapContextLinkingData,
      });

      let completionReported = false;
      const reportedMandateAttachmentSessionIds = new Set<string>();
      const targetSessionIds = Array.from(
        new Set(
          targetEvents.flatMap(({ sessionIds }) => {
            if (!sessionIds.length) {
              log(logs, 'warn', 'Target session event missing session ids', {
                eventId,
              });
              return [];
            }
            return sessionIds;
          })
        )
      );

      if (!targetSessionIds.length) {
        return { handled: true, logs };
      }

      trace(logs, 'Bootstrap target session ids resolved', {
        eventId,
        bootstrapSessionId,
        sessionIds: targetSessionIds,
      });

      for (const sessionId of targetSessionIds) {
        await deps.bootstrapContextRepository.saveTargetSessionBootstrapLink?.({
          targetSessionId: sessionId,
          bootstrapSessionId,
          createdAt: now,
        });
      }

      const primaryTargetSessionId = targetSessionIds[0];
      const resolvedPrimary = await resolvePayNoteDocument(
        primaryTargetSessionId,
        logs,
        deps
      );
      if (!resolvedPrimary) {
        throw new Error(
          `Failed to resolve bootstrap target document for session ${primaryTargetSessionId}`
        );
      }

      const isPayNote = resolvedPrimary.document
        ? isPayNoteDocument(resolvedPrimary.document)
        : true;
      const isPaymentMandate = resolvedPrimary.document
        ? isPaymentMandateDocument(resolvedPrimary.document)
        : false;

      trace(logs, 'Resolved paynote document from primary target session', {
        eventId,
        sessionId: primaryTargetSessionId,
        payNoteDocumentId: resolvedPrimary.documentId,
        isPayNote,
        isPaymentMandate,
      });

      for (const sessionId of targetSessionIds) {
        if (!isPayNote) {
          if (isPaymentMandate) {
            await upsertContractRecord({
              contractRepository: deps.contractRepository,
              document: resolvedPrimary.document,
              sessionId,
              documentId: resolvedPrimary.documentId,
              userId:
                deliveryRecord?.userId ??
                bootstrapRecord?.userId ??
                bootstrapContext?.userId,
              accountNumber:
                deliveryRecord?.accountNumber ??
                bootstrapRecord?.accountNumber ??
                bootstrapContext?.accountNumber,
              merchantId:
                deliveryRecord?.merchantId ?? bootstrapContext?.merchantId,
              now,
            });

            if (deliveryRecord) {
              const updatedDelivery = {
                ...deliveryRecord,
                paymentMandateDocumentId:
                  deliveryRecord.paymentMandateDocumentId ??
                  resolvedPrimary.documentId,
                paymentMandateBootstrapSessionId:
                  deliveryRecord.paymentMandateBootstrapSessionId ??
                  bootstrapSessionId,
                paymentMandateStatus: 'attached' as const,
                updatedAt: now,
              };
              await deps.payNoteDeliveryRepository.saveDelivery(
                updatedDelivery
              );
              await reportDeliveryMandateAttachmentToPayNotes({
                eventId,
                bootstrapSessionId,
                deliveryRecord: updatedDelivery,
                deps,
                logs,
                reportedSessionIds: reportedMandateAttachmentSessionIds,
              });
              log(
                logs,
                'info',
                'Payment mandate bootstrap linked to delivery',
                {
                  eventId,
                  deliveryId: deliveryRecord.deliveryId,
                  sessionId,
                  paymentMandateDocumentId: resolvedPrimary.documentId,
                  bootstrapSessionId: bootstrapSessionId ?? null,
                }
              );
            }
          }

          log(logs, 'info', 'Bootstrap target is not a PayNote document', {
            eventId,
            sessionId,
            documentId: resolvedPrimary.documentId,
          });

          if (!completionReported && bootstrapContext?.requestingSessionId) {
            completionReported = await reportBootstrapCompleted({
              eventId,
              bootstrapSessionId,
              documentId: resolvedPrimary.documentId,
              requestingSessionId: bootstrapContext.requestingSessionId,
              requestId: bootstrapContext.requestId,
              deps,
              logs,
            });
          }
          continue;
        }

        const payNoteDocumentId = resolvedPrimary.documentId;
        const existingPayNote = await deps.payNoteRepository.getPayNote(
          payNoteDocumentId
        );

        const updatedRecord = mergePayNoteRecord(existingPayNote, {
          payNoteDocumentId,
          sessionIds: [sessionId],
          deliveryId: deliveryRecord?.deliveryId,
          accountNumber:
            deliveryRecord?.accountNumber ??
            bootstrapRecord?.accountNumber ??
            bootstrapContext?.accountNumber,
          userId:
            deliveryRecord?.userId ??
            bootstrapRecord?.userId ??
            bootstrapContext?.userId,
          holdId: deliveryRecord?.holdId ?? bootstrapContext?.holdId,
          transactionId:
            deliveryRecord?.transactionId ?? bootstrapContext?.transactionId,
          merchantId:
            deliveryRecord?.merchantId ?? bootstrapContext?.merchantId,
          payerAccountNumber:
            bootstrapRecord?.payerAccountNumber ??
            bootstrapContext?.payerAccountNumber ??
            existingPayNote?.payerAccountNumber,
          payeeAccountNumber:
            bootstrapRecord?.payeeAccountNumber ??
            bootstrapContext?.payeeAccountNumber ??
            existingPayNote?.payeeAccountNumber,
          document: resolvedPrimary.document,
          createdAt: existingPayNote?.createdAt ?? now,
          updatedAt: now,
        });

        await deps.payNoteRepository.savePayNote(updatedRecord);
        await upsertPayNoteContractRecord({
          contractRepository: deps.contractRepository,
          updatedRecord,
          sessionId,
          documentId: payNoteDocumentId,
          customerChannelKey: bootstrapContext?.customerChannelKey,
          document: updatedRecord.document,
          emittedEvents,
          now,
        });

        if (deliveryRecord) {
          const updatedDelivery = {
            ...deliveryRecord,
            payNoteDocumentId:
              deliveryRecord.payNoteDocumentId ?? payNoteDocumentId,
            payNoteSessionIds: mergeSessionIds(
              deliveryRecord.payNoteSessionIds,
              [sessionId]
            ),
            payNoteDocument:
              resolvedPrimary.document ?? deliveryRecord.payNoteDocument,
            payNoteUpdatedAt: eventObject?.created ?? now,
            payNoteBootstrapSessionId:
              deliveryRecord.payNoteBootstrapSessionId ?? bootstrapSessionId,
            updatedAt: now,
          };

          await deps.payNoteDeliveryRepository.saveDelivery(updatedDelivery);
          await reportDeliveryMandateAttachmentToPayNotes({
            eventId,
            bootstrapSessionId,
            deliveryRecord: updatedDelivery,
            payNoteSessionIdHint: sessionId,
            deps,
            logs,
            reportedSessionIds: reportedMandateAttachmentSessionIds,
          });
        }

        if (deliveryRecord?.holdId) {
          await updateHoldPayNoteDocumentIdForBootstrap(
            logs,
            deliveryRecord.holdId,
            payNoteDocumentId,
            deps,
            { eventId, deliveryId: deliveryRecord.deliveryId }
          );
        }

        if (!completionReported && bootstrapContext?.requestingSessionId) {
          completionReported = await reportBootstrapCompleted({
            eventId,
            bootstrapSessionId,
            documentId: payNoteDocumentId,
            requestingSessionId: bootstrapContext.requestingSessionId,
            requestId: bootstrapContext.requestId,
            deps,
            logs,
          });
        }

        log(logs, 'info', 'PayNote bootstrap linked', {
          eventId,
          bootstrapSessionId,
          payNoteDocumentId,
          sessionId,
          deliveryId: deliveryRecord?.deliveryId,
        });
      }

      return { handled: true, logs };
    };

  let processingResult: HandlePayNoteBootstrapWebhookResult | undefined;
  let processingError: unknown;
  try {
    processingResult = await processBootstrapEvent();
  } catch (error) {
    processingError = error;
  }

  let lockError: unknown;
  if (claimedEvent) {
    try {
      if (processingError) {
        await deps.payNoteDeliveryRepository.releaseEventProcessing?.(eventId);
      } else {
        await deps.payNoteDeliveryRepository.finalizeEventProcessing?.(eventId);
      }
    } catch (error) {
      lockError = error;
      log(logs, 'error', 'Failed to update bootstrap event processing lock', {
        eventId,
        processingError: Boolean(processingError),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (processingError) {
    throw processingError;
  }
  if (lockError) {
    throw lockError;
  }

  return processingResult ?? { handled: true, logs };
};

export const consumePendingPayNoteBootstrapEvents = async (
  input: ConsumePendingPayNoteBootstrapEventsInput,
  deps: HandlePayNoteBootstrapWebhookDependencies
): Promise<ConsumePendingPayNoteBootstrapEventsResult> => {
  const logs: LogEntry[] = [];
  const bootstrapSessionId = input.bootstrapSessionId?.trim();

  if (!bootstrapSessionId) {
    log(
      logs,
      'warn',
      'Pending bootstrap consumption skipped (missing session)',
      {
        bootstrapSessionId: input.bootstrapSessionId,
      }
    );
    return { handled: false, consumedCount: 0, remainingCount: 0, logs };
  }

  const pendingEvents = await deps.pendingBootstrapEventRepository.listPending(
    bootstrapSessionId
  );

  if (!pendingEvents.length) {
    trace(logs, 'No pending bootstrap events to consume', {
      bootstrapSessionId,
    });
    return { handled: true, consumedCount: 0, remainingCount: 0, logs };
  }

  let consumedCount = 0;
  let remainingCount = 0;

  for (const pendingEvent of pendingEvents) {
    const { eventId } = pendingEvent;
    const eventResult = await deps.myOsClient.fetchEvent(eventId);

    if (eventResult.kind !== 'success') {
      remainingCount += 1;
      logMyOsFetchError(
        eventResult,
        logs,
        { bootstrapSessionId, eventId },
        fetchEventMessages
      );
      continue;
    }

    const processingResult = await handlePayNoteBootstrapWebhookEvent(
      {
        eventId,
        payload: eventResult.payload,
        skipEventIdempotencyClaim: true,
        skipPendingBuffer: true,
      },
      deps
    );
    logs.push(...processingResult.logs);

    if (processingResult.note === 'Deferred waiting for bootstrap context') {
      remainingCount += 1;
      continue;
    }

    await deps.pendingBootstrapEventRepository.deletePending({
      bootstrapSessionId,
      eventId,
    });
    consumedCount += 1;
    trace(logs, 'Consumed pending bootstrap event', {
      bootstrapSessionId,
      eventId,
    });
  }

  return { handled: true, consumedCount, remainingCount, logs };
};
