import { DocumentProcessingInitiatedSchema } from '@blue-repository/types/packages/core/schemas';
import { blue } from '../../../blue';
import type { LogEntry } from '../../ports';
import { logMyOsFetchError } from '../paynoteWebhook/myosErrors';
import { getString } from '../paynoteWebhook/utils';
import { toBlueNode, readFetchedDocumentId } from '../webhookUtils';
import type { HandlePayNoteDeliveryWebhookDependencies } from './types';

const fetchDocumentMessages = {
  notFound: 'Failed to resolve delivery document from MyOS',
  httpError: 'Failed to resolve delivery document from MyOS',
  parseError: 'Failed to parse delivery document response',
  networkError: 'Unexpected error resolving delivery document',
};

const readDeliveryDocumentIdFromEvent = (
  event: unknown
): string | undefined => {
  const node = toBlueNode(event);
  if (
    !node ||
    !blue.isTypeOf(node, DocumentProcessingInitiatedSchema, {
      checkSchemaExtensions: true,
    })
  ) {
    return undefined;
  }

  const output = blue.nodeToSchemaOutput(
    node,
    DocumentProcessingInitiatedSchema
  );
  return getString(output.documentId);
};

export const resolveDeliveryDocumentId = async (
  sessionId: string | undefined,
  emitted: unknown[] | undefined,
  logs: LogEntry[],
  deps: HandlePayNoteDeliveryWebhookDependencies
): Promise<string | undefined> => {
  const emittedDocumentId = (emitted ?? [])
    .map(readDeliveryDocumentIdFromEvent)
    .find((documentId): documentId is string => Boolean(documentId));
  if (emittedDocumentId) {
    return emittedDocumentId;
  }

  if (!sessionId) {
    return undefined;
  }

  const result = await deps.myOsClient.fetchDocument(sessionId);
  if (result.kind !== 'success') {
    logMyOsFetchError(result, logs, { sessionId }, fetchDocumentMessages);
    return undefined;
  }

  return readFetchedDocumentId(result.document) ?? result.document.documentId;
};
