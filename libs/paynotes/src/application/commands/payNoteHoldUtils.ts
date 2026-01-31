import type { Hold, HoldRepository } from '@demo-bank-app/banking';
import type { LogEntry } from '../ports';
import { trace } from './paynoteWebhook/logging';

type UpdateHoldPayNoteDocumentIdInput = {
  logs: LogEntry[];
  hold: Hold;
  holdRepository: HoldRepository;
  payNoteDocumentId: string;
  context?: { eventId?: string; deliveryId?: string };
  force?: boolean;
  message?: string;
};

export const updateHoldPayNoteDocumentId = async (
  input: UpdateHoldPayNoteDocumentIdInput
) => {
  const {
    logs,
    hold,
    holdRepository,
    payNoteDocumentId,
    context,
    force,
    message,
  } = input;

  if (!payNoteDocumentId) {
    return;
  }
  if (hold.payNoteDocumentId === payNoteDocumentId) {
    return;
  }
  if (hold.payNoteDocumentId && !force) {
    return;
  }

  await holdRepository.putHoldMeta({
    ...hold,
    payNoteDocumentId,
  });

  trace(logs, message ?? 'Updated hold PayNote reference', {
    eventId: context?.eventId,
    deliveryId: context?.deliveryId,
    holdId: hold.holdId,
    payNoteDocumentId,
    previousPayNoteDocumentId: hold.payNoteDocumentId ?? null,
  });
};
