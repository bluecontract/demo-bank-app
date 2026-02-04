import { dump as yamlDump } from 'js-yaml';
import { blue } from '../../../lib/blue';

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
