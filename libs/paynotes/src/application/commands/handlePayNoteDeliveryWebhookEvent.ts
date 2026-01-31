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
