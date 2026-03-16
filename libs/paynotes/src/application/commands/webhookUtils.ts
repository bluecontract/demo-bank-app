import type { BlueNode } from '@blue-labs/language';
import { blue } from '../../blue';

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const getString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readBlueId = (
  value: Record<string, unknown> | undefined
): string | undefined => getString(value?.blueId);

export const getPayloadSummary = (payload: unknown) => {
  if (payload && typeof payload === 'object') {
    return {
      payloadType: Array.isArray(payload) ? 'array' : 'object',
      payloadKeyCount: Object.keys(payload as Record<string, unknown>).length,
    };
  }
  return { payloadType: typeof payload };
};

export const toBlueNode = (value: unknown): BlueNode | null => {
  if (!value) {
    return null;
  }
  try {
    return blue.jsonValueToNode(value);
  } catch {
    return null;
  }
};

export const toSimpleBlueRecord = (
  value: unknown
): Record<string, unknown> | undefined => {
  const node = toBlueNode(value);
  if (node) {
    const simple = blue.nodeToJson(node, 'simple');
    const simpleRecord = asRecord(simple);
    if (simpleRecord) {
      return simpleRecord;
    }
  }

  return asRecord(value);
};

export const readInitializedDocumentId = (
  value: unknown
): string | undefined => {
  const simple = toSimpleBlueRecord(value);
  if (!simple) {
    return undefined;
  }

  const initialized = asRecord(simple.initialized);
  const initializedDocumentId = getString(initialized?.documentId);
  if (initializedDocumentId) {
    return initializedDocumentId;
  }

  const initializedDocumentRecord = asRecord(initialized?.documentId);
  return getString(initializedDocumentRecord?.value);
};

export const readFetchedDocumentId = (
  value: { documentId?: unknown; document?: unknown } | undefined
): string | undefined => {
  const initializedDocumentId = readInitializedDocumentId(value?.document);
  if (initializedDocumentId) {
    return initializedDocumentId;
  }

  const documentId = getString(value?.documentId);
  if (documentId) {
    return documentId;
  }

  const documentIdRecord = asRecord(value?.documentId);
  return getString(documentIdRecord?.value);
};

export const readEventObjectDocumentId = (
  value: unknown
): string | undefined => {
  const rawRecord = asRecord(value);
  const rawDocument = asRecord(rawRecord?.document);
  const rawDocumentId = getString(rawRecord?.documentId);
  if (rawDocumentId) {
    return rawDocumentId;
  }

  const rawInitializedDocumentId = readInitializedDocumentId(rawDocument);
  if (rawInitializedDocumentId) {
    return rawInitializedDocumentId;
  }

  const simpleRecord = toSimpleBlueRecord(value);
  const simpleDocument = asRecord(simpleRecord?.document);
  const simpleDocumentId = getString(simpleRecord?.documentId);
  if (simpleDocumentId) {
    return simpleDocumentId;
  }

  const simpleInitializedDocumentId = readInitializedDocumentId(simpleDocument);
  if (simpleInitializedDocumentId) {
    return simpleInitializedDocumentId;
  }

  const objectBlueId =
    rawRecord?.epoch === undefined && simpleRecord?.epoch === undefined
      ? readBlueId(rawRecord) ?? readBlueId(simpleRecord)
      : undefined;
  if (objectBlueId) {
    return objectBlueId;
  }

  return readInitializedDocumentId(value);
};
