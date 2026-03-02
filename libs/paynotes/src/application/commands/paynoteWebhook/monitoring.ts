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

const MONITORING_CONSENT_TITLE = 'Consent to data processing';
const UNKNOWN_REQUESTING_MERCHANT_NAME = 'Merchant';

const formatMonitoringConsentSummary = (
  targetMerchantName: string,
  requestingMerchantName: string
) =>
  `I agree to Synchrony sharing details of my card transactions at ${targetMerchantName} with ${requestingMerchantName}.`;

const resolveRequestingMerchantName = async (input: {
  merchantId?: string;
  resolver?: (merchantId: string) => Promise<string | undefined>;
}) => {
  const merchantId = getString(input.merchantId);
  if (!merchantId) {
    return UNKNOWN_REQUESTING_MERCHANT_NAME;
  }

  const resolvedName = getString(await input.resolver?.(merchantId));
  return resolvedName ?? UNKNOWN_REQUESTING_MERCHANT_NAME;
};

const resolveTargetMerchantName = async (input: {
  targetMerchantId: string;
  resolver?: (merchantId: string) => Promise<string | undefined>;
}) => {
  const resolvedName = getString(
    await input.resolver?.(input.targetMerchantId)
  );
  return resolvedName ?? input.targetMerchantId;
};

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
    const requestingMerchantName = await resolveRequestingMerchantName({
      merchantId: contract.merchantId,
      resolver: deps.resolveMerchantNameById,
    });
    const targetMerchantName = await resolveTargetMerchantName({
      targetMerchantId,
      resolver: deps.resolveMerchantNameById,
    });
    const upsertResult = upsertMonitoringRequestInContract({
      contract,
      targetMerchantId,
      requestedEvents,
      requestEventId: eventId,
      requestEventIndex: item.eventIndex,
      requestedAt: now,
      requestId: resolveMonitoringRequestId(item.event),
      pendingActionTitle: MONITORING_CONSENT_TITLE,
      pendingActionSummary: formatMonitoringConsentSummary(
        targetMerchantName,
        requestingMerchantName
      ),
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
