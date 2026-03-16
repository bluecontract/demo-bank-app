import { dump as yamlDump } from 'js-yaml';
import { blue } from '../../../lib/blue';

type UnknownRecord = Record<string, unknown>;

const toRecord = (value: unknown): UnknownRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
};

const toText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  const record = toRecord(value);
  if (record && typeof record.value === 'string') {
    const trimmed = record.value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  const record = toRecord(value);
  if (record && typeof record.value === 'boolean') {
    return record.value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return null;
};

export const formatYaml = (value: unknown) => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return yamlDump(value, { noRefs: true }).trimEnd();
  } catch {
    return null;
  }
};

export const formatJson = (value: unknown) => {
  if (value == null) {
    return null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
};

export const restoreInlineTypes = (value: unknown) => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    const node = blue.jsonValueToNode(value);
    const reversedNode = blue.reverse(node);
    const restoredNode = blue.restoreInlineTypes(reversedNode);
    return blue.nodeToJson(restoredNode);
  } catch {
    return value;
  }
};

export const getDocumentName = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = (value as { name?: unknown }).name;
  if (typeof name !== 'string') {
    return null;
  }

  const trimmed = name.trim();
  return trimmed ? trimmed : null;
};

export const getDocumentDescription = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const description = (value as { description?: unknown }).description;
  if (typeof description !== 'string') {
    return null;
  }

  const trimmed = description.trim();
  return trimmed ? trimmed : null;
};

export type PayNoteInitialStateAction = {
  title: string | null;
  summary: string | null;
  left: string | null;
  right: string | null;
};

export type PayNoteInitialStateMeta = {
  llmSummaryDisabled: boolean;
  summary: string | null;
  details: string | null;
  action: PayNoteInitialStateAction | null;
};

export const getPayNoteInitialStateMeta = (
  value: unknown
): PayNoteInitialStateMeta => {
  const record = toRecord(value);
  const llmSummaryDisabled = Boolean(
    record && toBoolean(record.LLM_SUMMARY_DISABLED)
  );

  const initialDescription = toRecord(record?.payNoteInitialStateDescription);
  const actionRecord = toRecord(initialDescription?.action);
  const action: PayNoteInitialStateAction | null = actionRecord
    ? {
        title: toText(actionRecord.title),
        summary: toText(actionRecord.summary),
        left: toText(actionRecord.left),
        right: toText(actionRecord.right),
      }
    : null;

  return {
    llmSummaryDisabled,
    summary: toText(initialDescription?.summary),
    details: toText(initialDescription?.details),
    action,
  };
};
