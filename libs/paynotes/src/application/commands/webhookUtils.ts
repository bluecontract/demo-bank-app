import type { BlueNode } from '@blue-labs/language';
import { blue } from '../../blue';

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
