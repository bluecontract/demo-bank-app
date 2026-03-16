import type {
  HandleWebhookEventDependencies,
  HandleWebhookEventInput,
  HandleWebhookEventResult,
} from './paynoteWebhook/types';
import {
  resolveWebhookContext,
  resolveWebhookPayload,
} from './paynoteWebhook/payload';
import {
  buildPayNoteRecord,
  persistPayNoteRecord,
  resolveDeliveryRecord,
  resolvePayNoteDocumentId,
  resolvePayNoteParsed,
} from './paynoteWebhook/records';
import { handleCaptureRequestEvents } from './paynoteWebhook/captureRequests';
import {
  handleTransferEvents,
  handleTransferMandateResponseEvents,
} from './paynoteWebhook/transfers';
import { dispatchPayNoteEvents } from './paynoteWebhook/eventDispatcher';
import { handleMonitoringRequestEvents } from './paynoteWebhook/monitoring';
import { handleCustomerActionRequestEvents } from './paynoteWebhook/customerAction';
import {
  handleChargeRequestEvents,
  handleMandateResponseEvents,
} from './paynoteWebhook/chargeRequests';
import { trace } from './paynoteWebhook/logging';
import { getString } from './paynoteWebhook/utils';
import { toCompactBlueJsonValue } from '../blue/compactBlue';

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const parseIsoTimestamp = (value: string): number | null => {
  if (!value.includes('T')) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveEventEpochOrder = (input: {
  eventType?: string;
  eventEpoch?: number;
}): number | undefined => {
  const { eventType, eventEpoch } = input;
  if (eventType === 'DOCUMENT_CREATED') {
    return -1;
  }
  if (eventType === 'DOCUMENT_EPOCH_ADVANCED' && eventEpoch !== undefined) {
    return eventEpoch;
  }
  return undefined;
};

export type {
  HandleWebhookEventDependencies,
  HandleWebhookEventInput,
  HandleWebhookEventResult,
} from './paynoteWebhook/types';

export const handleWebhookEvent = async (
  input: HandleWebhookEventInput,
  deps: HandleWebhookEventDependencies
): Promise<HandleWebhookEventResult> => {
  const logs: HandleWebhookEventResult['logs'] = [];
  trace(logs, 'PayNote webhook processing', {
    eventId: input.eventId,
    hasPayload: Boolean(input.eventPayload),
  });

  const payloadResolution = await resolveWebhookPayload(input, deps, logs);
  if ('result' in payloadResolution) {
    return payloadResolution.result;
  }

  const contextResolution = resolveWebhookContext(
    payloadResolution.payload,
    input.eventId,
    logs
  );
  if ('result' in contextResolution) {
    return contextResolution.result;
  }

  const {
    eventPayload,
    eventObject,
    eventType,
    eventEpoch,
    document,
    emittedEvents,
    events,
    sessionId,
  } = contextResolution.context;

  const firstProcess = await deps.payNoteRepository.markEventProcessed(
    input.eventId
  );
  if (!firstProcess) {
    const processingStatus =
      await deps.payNoteRepository.getEventProcessingStatus?.(input.eventId);
    if (processingStatus === 'completed') {
      trace(logs, 'PayNote webhook already processed', {
        eventId: input.eventId,
      });
      return { note: '', logs };
    }
    if (processingStatus === 'processing') {
      logs.push({
        level: 'info',
        message: 'PayNote webhook event already being processed',
        context: {
          eventId: input.eventId,
        },
      });
      throw new Error('PayNote webhook event is already being processed');
    }
    trace(logs, 'PayNote webhook already processed (status unknown)', {
      eventId: input.eventId,
    });
    return { note: '', logs };
  }
  let completed = false;
  let processingError: unknown;
  let processingResult: HandleWebhookEventResult | undefined;
  try {
    processingResult = await (async (): Promise<HandleWebhookEventResult> => {
      trace(logs, 'Resolved PayNote session id', {
        eventId: input.eventId,
        sessionId,
      });

      const payNoteRecord = await deps.payNoteRepository.getPayNoteBySessionId(
        sessionId
      );

      const documentResolution = await resolvePayNoteDocumentId({
        eventId: input.eventId,
        sessionId,
        document,
        eventObject,
        payNoteRecord,
        deps,
        logs,
      });

      if ('result' in documentResolution) {
        return documentResolution.result;
      }

      const { payNoteDocumentId, resolvedDocument, resolvedDocumentRaw } =
        documentResolution.resolution;

      const existingPayNoteByDocumentId =
        payNoteRecord ??
        (await deps.payNoteRepository.getPayNote(payNoteDocumentId));
      const incomingEventCreatedAt = getString(
        (eventPayload as { created?: unknown })?.created
      );
      const lastSourceEventCreatedAt = getString(
        existingPayNoteByDocumentId?.lastSourceEventCreatedAt
      );
      const incomingEventCreatedAtMs = incomingEventCreatedAt
        ? parseIsoTimestamp(incomingEventCreatedAt)
        : null;
      const lastSourceEventCreatedAtMs = lastSourceEventCreatedAt
        ? parseIsoTimestamp(lastSourceEventCreatedAt)
        : null;
      if (
        incomingEventCreatedAt &&
        lastSourceEventCreatedAt &&
        incomingEventCreatedAtMs !== null &&
        lastSourceEventCreatedAtMs !== null &&
        incomingEventCreatedAtMs < lastSourceEventCreatedAtMs
      ) {
        logs.push({
          level: 'info',
          message:
            'PayNote webhook event ignored (older than last processed source event)',
          context: {
            eventId: input.eventId,
            payNoteDocumentId,
            sessionId,
            incomingEventCreatedAt,
            lastSourceEventCreatedAt,
          },
        });
        return { note: '', logs };
      }
      const canonicalContract =
        await deps.contractRepository.getContractByDocumentId(
          payNoteDocumentId
        );
      const canonicalSessionId = getString(canonicalContract?.sessionId);
      if (canonicalSessionId && eventType === 'DOCUMENT_CREATED') {
        logs.push({
          level: 'info',
          message:
            'PayNote webhook event ignored (document created after canonical session established)',
          context: {
            eventId: input.eventId,
            payNoteDocumentId,
            sessionId,
            canonicalSessionId,
          },
        });
        return { note: '', logs };
      }
      if (canonicalSessionId && canonicalSessionId !== sessionId) {
        logs.push({
          level: 'info',
          message: 'PayNote webhook event ignored (non-canonical session)',
          context: {
            eventId: input.eventId,
            payNoteDocumentId,
            sessionId,
            canonicalSessionId,
          },
        });
        return { note: '', logs };
      }
      const isEpochAdvancedWithoutCanonicalSession =
        eventType === 'DOCUMENT_EPOCH_ADVANCED' &&
        eventEpoch !== undefined &&
        eventEpoch > 0 &&
        !canonicalSessionId;
      if (isEpochAdvancedWithoutCanonicalSession) {
        logs.push({
          level: 'info',
          message:
            'PayNote webhook event ignored (canonical session not established yet)',
          context: {
            eventId: input.eventId,
            payNoteDocumentId,
            sessionId,
            eventType,
            eventEpoch,
          },
        });
        return { note: '', logs };
      }
      const incomingEventEpochOrder = resolveEventEpochOrder({
        eventType,
        eventEpoch,
      });
      const existingEventEpochOrder =
        existingPayNoteByDocumentId?.lastSourceEventEpoch;
      if (
        incomingEventEpochOrder !== undefined &&
        existingEventEpochOrder !== undefined &&
        incomingEventEpochOrder < existingEventEpochOrder
      ) {
        logs.push({
          level: 'info',
          message:
            'PayNote webhook event ignored (older than last processed source epoch)',
          context: {
            eventId: input.eventId,
            payNoteDocumentId,
            sessionId,
            incomingEventEpochOrder,
            existingEventEpochOrder,
          },
        });
        return { note: '', logs };
      }

      const now = deps.clock.now().toISOString();
      const existingRecord = existingPayNoteByDocumentId;
      const nextSourceEventCreatedAt =
        incomingEventCreatedAt &&
        incomingEventCreatedAtMs !== null &&
        (!lastSourceEventCreatedAt ||
          lastSourceEventCreatedAtMs === null ||
          incomingEventCreatedAtMs >= lastSourceEventCreatedAtMs)
          ? incomingEventCreatedAt
          : lastSourceEventCreatedAt;

      const deliveryRecord = await resolveDeliveryRecord(
        existingRecord,
        payNoteDocumentId,
        deps
      );
      let bootstrapContext =
        await deps.bootstrapContextRepository.getContextBySessionId(sessionId);
      if (!bootstrapContext) {
        const bootstrapSessionId =
          await deps.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId?.(
            sessionId
          );
        if (bootstrapSessionId) {
          bootstrapContext =
            await deps.bootstrapContextRepository.getContextBySessionId(
              bootstrapSessionId
            );
          trace(logs, 'Resolved bootstrap context via target session link', {
            eventId: input.eventId,
            sessionId,
            bootstrapSessionId,
            hasBootstrapContext: Boolean(bootstrapContext),
          });
        }
      }

      trace(logs, 'Resolved PayNote delivery linkage', {
        eventId: input.eventId,
        payNoteDocumentId,
        hasPayNoteRecord: Boolean(existingRecord),
        deliveryId: deliveryRecord?.deliveryId ?? null,
      });

      const payNoteParsedResolution = resolvePayNoteParsed({
        document,
        resolvedDocument,
        eventId: input.eventId,
        sessionId,
        logs,
      });

      if ('result' in payNoteParsedResolution) {
        return payNoteParsedResolution.result;
      }

      const payNoteParsed = payNoteParsedResolution.parsed;
      const { updatedRecord, payerAccountNumber, payeeAccountNumber } =
        buildPayNoteRecord({
          payNoteDocumentId,
          sessionId,
          existingRecord,
          deliveryRecord,
          bootstrapMerchantId: bootstrapContext?.merchantId,
          bootstrapAccountNumber: bootstrapContext?.accountNumber,
          bootstrapUserId: bootstrapContext?.userId,
          bootstrapHoldId: bootstrapContext?.holdId,
          bootstrapTransactionId: bootstrapContext?.transactionId,
          document,
          resolvedDocument,
          eventObject,
          eventCreatedAt: nextSourceEventCreatedAt,
          eventEpochOrder:
            incomingEventEpochOrder !== undefined
              ? incomingEventEpochOrder
              : existingEventEpochOrder,
          payNoteParsed,
          now,
        });

      await persistPayNoteRecord({
        updatedRecord,
        deliveryRecord,
        documentForStorage:
          asRecord(toCompactBlueJsonValue(eventObject?.document)) ??
          asRecord(toCompactBlueJsonValue(resolvedDocumentRaw)) ??
          updatedRecord.document,
        sessionId,
        payNoteDocumentId,
        eventType,
        eventObject,
        emittedEvents,
        now,
        deps,
      });

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

      const {
        captureRequestEvents,
        chargeRequestEvents,
        mandateResponseEvents,
        transferEvents,
        monitoringRequestEvents,
        customerActionRequestEvents,
      } = dispatchPayNoteEvents({
        events,
        eventId: input.eventId,
        payNoteDocumentId,
        logs,
      });

      await handleMonitoringRequestEvents({
        events: monitoringRequestEvents,
        eventId: input.eventId,
        payNoteDocumentId,
        sessionId,
        deps,
        logs,
      });

      await handleCustomerActionRequestEvents({
        events: customerActionRequestEvents,
        eventId: input.eventId,
        eventEpoch,
        payNoteDocumentId,
        sessionId,
        deps,
        logs,
      });

      await handleCaptureRequestEvents({
        events: captureRequestEvents,
        eventId: input.eventId,
        payNoteDocumentId,
        sessionId,
        updatedRecord,
        eventObject,
        emittedEvents,
        deps,
        logs,
      });

      const chargeResult = await handleChargeRequestEvents({
        events: chargeRequestEvents,
        eventId: input.eventId,
        payNoteDocumentId,
        sessionId,
        eventObject,
        updatedRecord,
        deliveryRecord,
        deps,
        logs,
      });

      if (chargeResult) {
        return chargeResult;
      }

      const mandateResponseResult = await handleMandateResponseEvents({
        events: mandateResponseEvents,
        eventId: input.eventId,
        payNoteDocumentId,
        sessionId,
        eventObject,
        deps,
        logs,
      });

      if (mandateResponseResult) {
        return mandateResponseResult;
      }

      const transferMandateResponseResult =
        await handleTransferMandateResponseEvents({
          events: mandateResponseEvents,
          eventId: input.eventId,
          payNoteDocumentId,
          sessionId,
          deps,
          logs,
        });

      if (transferMandateResponseResult) {
        return transferMandateResponseResult;
      }

      const transferDescription =
        getString(payNoteParsed.output.name) ?? 'PayNote transfer';

      const transferResult = await handleTransferEvents({
        events: transferEvents,
        eventId: input.eventId,
        payNoteDocumentId,
        sessionId,
        eventObject,
        emittedEvents,
        payerAccountNumber,
        payeeAccountNumber,
        transferDescription,
        updatedRecord,
        deliveryRecord,
        deps,
        logs,
      });

      if (transferResult) {
        return transferResult;
      }

      return { note: '', logs };
    })();
    completed = true;
  } catch (error) {
    processingError = error;
  }

  let lockError: unknown;
  try {
    if (completed) {
      await deps.payNoteRepository.finalizeEventProcessing?.(input.eventId);
    } else {
      await deps.payNoteRepository.releaseEventProcessing?.(input.eventId);
    }
  } catch (error) {
    lockError = error;
    logs.push({
      level: 'error',
      message: 'Failed to update paynote event processing lock',
      context: {
        eventId: input.eventId,
        completed,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  if (processingError) {
    throw processingError;
  }
  if (lockError) {
    throw lockError;
  }

  return processingResult ?? { note: '', logs };
};
