import {
  PayNoteSchema,
  PaymentMandateSchema,
} from '@blue-repository/types/packages/paynote/schemas';
import type { LogEntry } from '../../ports';
import { blue } from '../../../blue';
import {
  isPaymentMandateDocumentNode,
  resolveRuntimeDocument,
} from '../blueRuntime';
import { isRecord } from '../typeGuards';
import { toBlueNode } from '../webhookUtils';
import {
  CHARGE_ATTEMPT_ID_PREFIX,
  TRANSFER_MANDATE_CHARGE_ATTEMPT_ID_PREFIX,
} from './events';
import type { HandleWebhookEventDependencies } from './types';

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

export const getStringOrNestedValue = (value: unknown): string | undefined => {
  const direct = getString(value);
  if (direct) {
    return direct;
  }

  const record = toSimpleRecord(value);
  return record ? getString(record.value) : undefined;
};

export const getRecordString = (
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  return record ? getString(record[key]) : undefined;
};

export const resolveOperationFailureReason = (input: {
  status: number;
  body?: unknown;
  fallbackPrefix: string;
}): string => {
  const bodyRecord = toSimpleRecord(input.body);
  const detail =
    getString(bodyRecord?.detail) ??
    getString(bodyRecord?.message) ??
    getString(bodyRecord?.error);
  return detail
    ? `${input.fallbackPrefix}: ${detail}`
    : `${input.fallbackPrefix} with status ${input.status}.`;
};

export const resolveCredentials = async (
  deps: HandleWebhookEventDependencies,
  logs: LogEntry[],
  context: {
    eventId: string;
    payNoteDocumentId: string;
    sessionId: string;
    errorMessage?: string;
  }
): Promise<Awaited<
  ReturnType<HandleWebhookEventDependencies['myOsClient']['getCredentials']>
> | null> => {
  try {
    return await deps.myOsClient.getCredentials();
  } catch (error) {
    logs.push({
      level: 'error',
      message: context.errorMessage ?? 'Failed to resolve MyOS credentials',
      context: {
        eventId: context.eventId,
        payNoteDocumentId: context.payNoteDocumentId,
        sessionId: context.sessionId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
};

export const parseChargeAttemptId = (
  value: string
): {
  payNoteDocumentId: string;
  eventId: string;
  eventIndex: number;
} | null => {
  let payload = value;
  if (value.startsWith(CHARGE_ATTEMPT_ID_PREFIX)) {
    payload = value.slice(CHARGE_ATTEMPT_ID_PREFIX.length);
  } else if (value.startsWith(TRANSFER_MANDATE_CHARGE_ATTEMPT_ID_PREFIX)) {
    const transferPayload = value.slice(
      TRANSFER_MANDATE_CHARGE_ATTEMPT_ID_PREFIX.length
    );
    const firstDelimiter = transferPayload.indexOf(':');
    if (firstDelimiter < 0) {
      return null;
    }
    payload = transferPayload.slice(firstDelimiter + 1);
  }

  const parts = payload.split(':');
  if (parts.length < 3) {
    return null;
  }

  const eventIndexRaw = parts.pop();
  const eventId = parts.pop();
  const payNoteDocumentId = parts.join(':');
  if (!eventIndexRaw || !eventId || !payNoteDocumentId) {
    return null;
  }

  const eventIndex = Number.parseInt(eventIndexRaw, 10);
  if (!Number.isInteger(eventIndex) || eventIndex < 0) {
    return null;
  }

  return {
    payNoteDocumentId,
    eventId,
    eventIndex,
  };
};
