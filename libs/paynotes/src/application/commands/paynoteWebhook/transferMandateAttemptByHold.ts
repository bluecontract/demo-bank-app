import type { PayNoteRecord } from '../../ports';

export type TransferMandateAttemptAuthorization = {
  mandateDocumentId: string;
  mandateSessionId: string;
  chargeAttemptId: string;
};

export const upsertTransferMandateAttemptByHoldId = (input: {
  updatedRecord: PayNoteRecord;
  holdId: string;
  authorization: TransferMandateAttemptAuthorization;
  updatedAt: string;
}): boolean => {
  const nextEntry = {
    mandateDocumentId: input.authorization.mandateDocumentId,
    mandateSessionId: input.authorization.mandateSessionId,
    chargeAttemptId: input.authorization.chargeAttemptId,
    updatedAt: input.updatedAt,
  };
  const currentEntries =
    input.updatedRecord.transferMandateAttemptsByHoldId ?? {};
  const currentEntry = currentEntries[input.holdId];
  const isUnchanged =
    currentEntry?.mandateDocumentId === nextEntry.mandateDocumentId &&
    currentEntry?.mandateSessionId === nextEntry.mandateSessionId &&
    currentEntry?.chargeAttemptId === nextEntry.chargeAttemptId;
  if (isUnchanged) {
    return false;
  }

  input.updatedRecord.transferMandateAttemptsByHoldId = {
    ...currentEntries,
    [input.holdId]: nextEntry,
  };
  return true;
};
