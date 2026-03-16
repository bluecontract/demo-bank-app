import type { BlueNode } from '@blue-labs/language';
import { PaymentMandateSchema } from '@blue-repository/types/packages/paynote/schemas';
import { blue } from '../../blue';
import { isRecord } from './typeGuards';
import { toBlueNode } from './webhookUtils';

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

export const resolveRuntimeContracts = (
  value: unknown
): Record<string, unknown> | null => {
  const runtimeDocument = resolveRuntimeDocument(value);
  if (!runtimeDocument?.resolved) {
    return null;
  }

  const contracts = runtimeDocument.record.contracts;
  return isRecord(contracts) ? contracts : null;
};
