import type { LogEntry } from '../../ports';
import { logMyOsFetchError } from '../paynoteWebhook/myosErrors';
import type { HandlePayNoteDeliveryWebhookDependencies } from './types';

const fetchDocumentMessages = {
  notFound: 'Failed to resolve delivery document from MyOS',
  httpError: 'Failed to resolve delivery document from MyOS',
  parseError: 'Failed to parse delivery document response',
  networkError: 'Unexpected error resolving delivery document',
};

export const resolveDeliveryDocumentId = async (
  sessionId: string | undefined,
  logs: LogEntry[],
  deps: HandlePayNoteDeliveryWebhookDependencies
): Promise<string | undefined> => {
  if (!sessionId) {
    return undefined;
  }

  const result = await deps.myOsClient.fetchDocument(sessionId);
  if (result.kind !== 'success') {
    logMyOsFetchError(result, logs, { sessionId }, fetchDocumentMessages);
    return undefined;
  }

  return result.document.documentId;
};
