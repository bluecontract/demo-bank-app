import type { LogEntry } from '../ports';
import type {
  HandlePayNoteDeliveryWebhookDependencies,
  HandlePayNoteDeliveryWebhookInput,
  HandlePayNoteDeliveryWebhookResult,
} from './paynoteDeliveryWebhook/types';
import { handleBootstrapRequests } from './paynoteDeliveryWebhook/bootstrap';
import { handleDeliveryDocumentUpdate } from './paynoteDeliveryWebhook/deliveryUpdate';
import { resolveDeliveryWebhookContext } from './paynoteDeliveryWebhook/payload';
import { log, trace } from './paynoteWebhook/logging';

export type {
  HandlePayNoteDeliveryWebhookDependencies,
  HandlePayNoteDeliveryWebhookInput,
  HandlePayNoteDeliveryWebhookResult,
} from './paynoteDeliveryWebhook/types';

export const handlePayNoteDeliveryWebhookEvent = async (
  input: HandlePayNoteDeliveryWebhookInput,
  deps: HandlePayNoteDeliveryWebhookDependencies
): Promise<HandlePayNoteDeliveryWebhookResult> => {
  const logs: LogEntry[] = [];

  const contextResolution = resolveDeliveryWebhookContext(input, logs);
  if ('result' in contextResolution) {
    return contextResolution.result;
  }

  const {
    eventId,
    eventType,
    eventObject,
    documentPayload,
    emitted,
    documentBootstrapRequests,
    isDeliveryDoc,
  } = contextResolution.context;

  if (!documentBootstrapRequests.length && !isDeliveryDoc) {
    trace(logs, 'Delivery webhook skipped (not a delivery event)', {
      eventId,
      sessionId: eventObject?.sessionId,
      eventType,
    });
    return { handled: false, logs };
  }

  let claimedEvent = false;
  if (!input.skipEventIdempotencyClaim) {
    const firstProcess =
      await deps.payNoteDeliveryRepository.markEventProcessed(eventId);
    if (!firstProcess) {
      log(logs, 'info', 'PayNote delivery webhook already processed', {
        eventId,
      });
      return { handled: true, logs };
    }
    claimedEvent = true;
  } else {
    trace(logs, 'Delivery webhook idempotency claim skipped', { eventId });
  }

  let completed = false;
  let processingError: unknown;
  try {
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

    completed = true;
  } catch (error) {
    processingError = error;
  }

  let lockError: unknown;
  if (claimedEvent) {
    try {
      if (completed) {
        await deps.payNoteDeliveryRepository.finalizeEventProcessing?.(eventId);
      } else {
        await deps.payNoteDeliveryRepository.releaseEventProcessing?.(eventId);
      }
    } catch (error) {
      lockError = error;
      log(logs, 'error', 'Failed to update delivery event processing lock', {
        eventId,
        completed,
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

  return { handled: true, logs };
};
