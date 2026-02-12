import { StartCardTransactionMonitoringRequestedSchema } from '@blue-repository/types/packages/paynote/schemas';
import {
  normalizeMonitoringEvents,
  supportsOnlyTransactionMonitoringEvents,
  upsertMonitoringRequestInContract,
} from '@demo-bank-app/contracts';
import { blue } from '../../../blue';
import type { LogEntry } from '../../ports';
import type {
  HandleWebhookEventDependencies,
  WebhookEmittedEvent,
} from './types';
import { resolveMonitoringRequestId } from './events';
import { getString } from './utils';

type MonitoringRequestEvent = {
  event: WebhookEmittedEvent;
  eventType?: string;
  eventIndex: number;
};

const buildMonitoringRequestDedupeKey = (input: {
  eventId: string;
  eventIndex: number;
}) => `paynote-monitoring-request:${input.eventId}:${input.eventIndex}`;

const parseMonitoringRequest = (event: WebhookEmittedEvent) => {
  try {
    const node = blue.jsonValueToNode(event);
    if (!blue.isTypeOf(node, StartCardTransactionMonitoringRequestedSchema)) {
      return null;
    }
    return blue.nodeToSchemaOutput(
      node,
      StartCardTransactionMonitoringRequestedSchema
    );
  } catch {
    return null;
  }
};

export const handleMonitoringRequestEvents = async (input: {
  events: MonitoringRequestEvent[];
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const { events, eventId, payNoteDocumentId, sessionId, deps, logs } = input;

  for (const item of events) {
    const dedupeKey = buildMonitoringRequestDedupeKey({
      eventId,
      eventIndex: item.eventIndex,
    });
    const firstProcessing = await deps.payNoteRepository.markEventProcessed(
      dedupeKey
    );
    if (!firstProcessing) {
      logs.push({
        level: 'info',
        message: 'Skipped duplicate monitoring request event',
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
          eventType: item.eventType ?? null,
        },
      });
      continue;
    }

    const contract = await deps.contractRepository.getContractBySessionId(
      sessionId
    );
    if (!contract || contract.sessionId !== sessionId) {
      logs.push({
        level: 'info',
        message:
          'Monitoring request ignored (unknown or non-canonical contract session)',
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
        },
      });
      continue;
    }

    const request = parseMonitoringRequest(item.event);
    const targetMerchantId = getString(request?.targetMerchantId);
    const requestedEvents = normalizeMonitoringEvents(request?.events);

    if (!targetMerchantId) {
      logs.push({
        level: 'warn',
        message: 'Monitoring request ignored (missing target merchant id)',
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
        },
      });
      continue;
    }

    if (!supportsOnlyTransactionMonitoringEvents(requestedEvents)) {
      logs.push({
        level: 'warn',
        message: 'Monitoring request ignored (unsupported event categories)',
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
          targetMerchantId,
          requestedEvents,
        },
      });
      continue;
    }

    const now = deps.clock.now().toISOString();
    const upsertResult = upsertMonitoringRequestInContract({
      contract,
      targetMerchantId,
      requestedEvents,
      requestEventId: eventId,
      requestEventIndex: item.eventIndex,
      requestedAt: now,
      requestId: resolveMonitoringRequestId(item.event),
    });

    if (!upsertResult.changed) {
      logs.push({
        level: 'info',
        message: 'Monitoring request deduplicated by contract and merchant',
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
          targetMerchantId,
          reason: upsertResult.reason,
          subscriptionId: upsertResult.subscription.subscriptionId,
        },
      });
      continue;
    }

    await deps.contractRepository.saveContract({
      ...upsertResult.contract,
      updatedAt: now,
    });

    await deps.contractRepository.addContractHistoryEntry({
      contractId: contract.contractId,
      kind: 'pendingActionRequested',
      short: 'Monitoring consent requested.',
      more: `Contract requested monitoring for merchant ${targetMerchantId}.`,
      createdAt: now,
    });

    logs.push({
      level: 'info',
      message: 'Monitoring request recorded as pending action',
      context: {
        eventId,
        payNoteDocumentId,
        sessionId,
        eventIndex: item.eventIndex,
        targetMerchantId,
        pendingActionId: upsertResult.action.actionId,
        subscriptionId: upsertResult.subscription.subscriptionId,
      },
    });
  }
};
