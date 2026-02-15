import {
  PayNoteSchema,
  PaymentMandateSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import { blue } from '../../../blue';
import {
  isPaymentMandateDocumentNode,
  resolveRuntimeDocument,
} from '../blueRuntime';
import { isRecord } from '../typeGuards';
import { toBlueNode } from '../webhookUtils';

export const toSimpleRecord = (
  value: unknown
): Record<string, unknown> | null => {
  const node = toBlueNode(value);
  if (node) {
    const simple = blue.nodeToJson(node, 'simple');
    if (isRecord(simple)) {
      return simple;
    }
  }
  return isRecord(value) ? value : null;
};

export const parsePayNoteDocument = (value: unknown) => {
  const runtimeDocument = resolveRuntimeDocument(value);
  if (!runtimeDocument) {
    return null;
  }
  const node = runtimeDocument.node;

  const isPayNote = blue.isTypeOf(node, PayNoteSchema, {
    checkSchemaExtensions: true,
  });
  const isPaymentMandate = isPaymentMandateDocumentNode(node);
  if (!isPayNote && !isPaymentMandate) {
    return null;
  }

  if (!runtimeDocument.resolved && !isPaymentMandate) {
    return null;
  }

  if (isPaymentMandate) {
    return {
      node,
      output: blue.nodeToSchemaOutput(node, PaymentMandateSchema),
    };
  }

  return {
    node,
    output: blue.nodeToSchemaOutput(node, PayNoteSchema),
  };
};

export const getString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const getRecordString = (
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  return record ? getString(record[key]) : undefined;
};
