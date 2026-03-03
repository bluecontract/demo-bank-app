import { BlueNode } from '@blue-labs/language';
import { CustomerActionRequestedSchema } from '@blue-repository/types/packages/conversation/schemas';
import type {
  ContractPendingAction,
  ContractPendingCustomerAction,
} from '@demo-bank-app/contracts';
import { blue } from '../../../blue';
import type { LogEntry } from '../../ports';
import type {
  HandleWebhookEventDependencies,
  WebhookEmittedEvent,
} from './types';
import { getString } from './utils';

type CustomerActionRequestEvent = {
  event: WebhookEmittedEvent;
  eventType?: string;
  eventIndex: number;
};

const ALLOWED_VARIANTS = new Set(['primary', 'secondary', 'reject']);

const buildCustomerActionRequestDedupeKey = (input: {
  eventId: string;
  eventIndex: number;
}) => `paynote-customer-action-request:${input.eventId}:${input.eventIndex}`;

const buildCustomerActionPendingActionId = (input: {
  eventId: string;
  eventIndex: number;
}) => `customer-action:${input.eventId}:${input.eventIndex}`;

const parseCustomerActionRequest = (event: WebhookEmittedEvent) => {
  try {
    const node = blue.jsonValueToNode(event);
    if (!blue.isTypeOf(node, CustomerActionRequestedSchema)) {
      return null;
    }
    return blue.nodeToSchemaOutput(node, CustomerActionRequestedSchema);
  } catch {
    return null;
  }
};

const toInputSchemaJson = (value: unknown): unknown | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    const node =
      value instanceof BlueNode ? value : blue.jsonValueToNode(value);
    return blue.nodeToJson(node, 'official');
  } catch {
    return undefined;
  }
};

const normalizeCustomerActionOptions = (
  actions: unknown
):
  | {
      ok: true;
      actions: ContractPendingCustomerAction[];
    }
  | {
      ok: false;
      reason: string;
      details?: Record<string, unknown>;
    } => {
  if (!Array.isArray(actions) || actions.length === 0) {
    return {
      ok: false,
      reason: 'missing-actions',
    };
  }

  const labels = new Set<string>();
  const normalized: ContractPendingCustomerAction[] = [];

  for (const item of actions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        ok: false,
        reason: 'invalid-action-item',
      };
    }

    const label = getString((item as { label?: unknown }).label);
    if (!label) {
      return {
        ok: false,
        reason: 'missing-action-label',
      };
    }

    if (labels.has(label)) {
      return {
        ok: false,
        reason: 'duplicate-action-label',
        details: { label },
      };
    }
    labels.add(label);

    const variantRaw = getString((item as { variant?: unknown }).variant);
    const variant =
      variantRaw && ALLOWED_VARIANTS.has(variantRaw)
        ? (variantRaw as ContractPendingCustomerAction['variant'])
        : undefined;

    if (variantRaw && !variant) {
      return {
        ok: false,
        reason: 'invalid-action-variant',
        details: { label, variant: variantRaw },
      };
    }

    const inputSchemaRaw = (item as { inputSchema?: unknown }).inputSchema;
    const inputSchema = toInputSchemaJson(inputSchemaRaw);
    if (inputSchemaRaw !== undefined && inputSchema === undefined) {
      return {
        ok: false,
        reason: 'invalid-input-schema',
        details: { label },
      };
    }

    const inputRequiredRaw = (item as { inputRequired?: unknown })
      .inputRequired;
    const inputRequired =
      typeof inputRequiredRaw === 'boolean' ? inputRequiredRaw : undefined;

    const inputTitle = getString((item as { inputTitle?: unknown }).inputTitle);
    const inputPlaceholder = getString(
      (item as { inputPlaceholder?: unknown }).inputPlaceholder
    );

    normalized.push({
      label,
      ...(variant ? { variant } : {}),
      ...(inputSchema !== undefined ? { inputSchema } : {}),
      ...(inputRequired !== undefined ? { inputRequired } : {}),
      ...(inputTitle ? { inputTitle } : {}),
      ...(inputPlaceholder ? { inputPlaceholder } : {}),
    });
  }

  return {
    ok: true,
    actions: normalized,
  };
};

const resolveCustomerActionType = (
  actions: ContractPendingCustomerAction[]
): ContractPendingAction['type'] =>
  actions.some(action => action.inputSchema !== undefined)
    ? 'customerActionInput'
    : 'customerActionOptions';

export const handleCustomerActionRequestEvents = async (input: {
  events: CustomerActionRequestEvent[];
  eventId: string;
  payNoteDocumentId: string;
  sessionId: string;
  deps: HandleWebhookEventDependencies;
  logs: LogEntry[];
}): Promise<void> => {
  const { events, eventId, payNoteDocumentId, sessionId, deps, logs } = input;

  for (const item of events) {
    const dedupeKey = buildCustomerActionRequestDedupeKey({
      eventId,
      eventIndex: item.eventIndex,
    });

    const firstProcessing = await deps.payNoteRepository.markEventProcessed(
      dedupeKey
    );
    if (!firstProcessing) {
      logs.push({
        level: 'info',
        message: 'Skipped duplicate customer action request event',
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
          'Customer action request ignored (unknown or non-canonical contract session)',
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
        },
      });
      continue;
    }

    const request = parseCustomerActionRequest(item.event);
    const message = getString(request?.message);
    if (!message) {
      logs.push({
        level: 'warn',
        message: 'Customer action request ignored (missing message)',
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
        },
      });
      continue;
    }

    const optionsResult = normalizeCustomerActionOptions(request?.actions);
    if (!optionsResult.ok) {
      logs.push({
        level: 'warn',
        message: `Customer action request ignored (${optionsResult.reason})`,
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
          ...(optionsResult.details ?? {}),
        },
      });
      continue;
    }

    const actionId = buildCustomerActionPendingActionId({
      eventId,
      eventIndex: item.eventIndex,
    });

    const existing = (contract.pendingActions ?? []).find(
      action => action.actionId === actionId
    );
    if (existing) {
      logs.push({
        level: 'info',
        message: 'Customer action request deduplicated by action id',
        context: {
          eventId,
          payNoteDocumentId,
          sessionId,
          eventIndex: item.eventIndex,
          actionId,
        },
      });
      continue;
    }

    const now = deps.clock.now().toISOString();
    const title =
      getString(request?.title) ?? getString(request?.name) ?? 'Pending action';
    const requestId = getString(request?.requestId);

    const nextAction: ContractPendingAction = {
      actionId,
      type: resolveCustomerActionType(optionsResult.actions),
      status: 'pending',
      title,
      message,
      actions: optionsResult.actions,
      createdAt: now,
      ...(requestId ? { requestId } : {}),
    };

    await deps.contractRepository.saveContract({
      ...contract,
      pendingActions: [...(contract.pendingActions ?? []), nextAction],
      updatedAt: now,
    });

    await deps.contractRepository.addContractHistoryEntry({
      contractId: contract.contractId,
      kind: 'pendingActionRequested',
      short: 'Customer action requested.',
      more: `Contract requested customer action: ${title}.`,
      createdAt: now,
    });

    logs.push({
      level: 'info',
      message: 'Customer action request recorded as pending action',
      context: {
        eventId,
        payNoteDocumentId,
        sessionId,
        eventIndex: item.eventIndex,
        actionId,
        type: nextAction.type,
        requestId: requestId ?? null,
      },
    });
  }
};
