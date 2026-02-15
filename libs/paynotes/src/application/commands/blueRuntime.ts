import type { BlueNode } from '@blue-labs/language';
import { PaymentMandateSchema } from '@blue-repository/types/packages/paynote/schemas';
import { blue } from '../../blue';
import { toBlueNode } from './webhookUtils';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export type RuntimeDocumentResolution = {
  node: BlueNode;
  record: Record<string, unknown>;
  resolved: boolean;
};

export const resolveRuntimeDocument = (
  value: unknown
): RuntimeDocumentResolution | null => {
  const node = toBlueNode(value);
  if (!node) {
    return null;
  }

  try {
    const resolved = blue.resolve(node);
    const simple = blue.nodeToJson(resolved, 'simple');
    if (!isRecord(simple)) {
      return null;
    }

    return {
      node: resolved,
      record: simple,
      resolved: true,
    };
  } catch {
    const simple = blue.nodeToJson(node, 'simple');
    const record = isRecord(simple) ? simple : isRecord(value) ? value : null;
    if (!record) {
      return null;
    }

    return {
      node,
      record,
      resolved: false,
    };
  }
};

export const isPaymentMandateDocumentNode = (node: BlueNode): boolean =>
  blue.isTypeOf(node, PaymentMandateSchema, {
    checkSchemaExtensions: true,
  });
