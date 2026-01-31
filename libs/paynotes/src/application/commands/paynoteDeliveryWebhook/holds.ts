import type { Hold } from '@demo-bank-app/banking';
import type { LogEntry, PayNoteDeliveryRecord } from '../../ports';
import { updateHoldPayNoteDocumentId } from '../payNoteHoldUtils';
import type { HandlePayNoteDeliveryWebhookDependencies } from './types';

export const syncHoldPayNoteReference = async (input: {
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

  await updateHoldPayNoteDocumentId({
    logs,
    hold,
    holdRepository: deps.holdRepository,
    payNoteDocumentId: payNoteReferenceId,
    context: {
      eventId,
      deliveryId,
    },
    force: Boolean(deliveryRecord.payNoteDocumentId),
  });
};
