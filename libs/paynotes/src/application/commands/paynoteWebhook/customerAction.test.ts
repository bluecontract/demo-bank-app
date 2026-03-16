import { describe, expect, it, vi } from 'vitest';
import type { ContractRecord } from '@demo-bank-app/contracts';
import { handleCustomerActionRequestEvents } from './customerAction';
import type { HandleWebhookEventDependencies } from './types';

const NOW = '2026-03-03T12:00:00.000Z';

const createContract = (): ContractRecord => ({
  contractId: 'contract-1',
  typeBlueId: 'PayNote/PayNote',
  displayName: 'PayNote contract',
  sessionId: 'session-1',
  documentId: 'doc-1',
  createdAt: NOW,
  updatedAt: NOW,
});

const createDeps = (contract: ContractRecord) => {
  const payNoteRepository = {
    markEventProcessed: vi.fn().mockResolvedValue(true),
  };

  const contractRepository = {
    getContractBySessionId: vi.fn().mockResolvedValue(contract),
    saveContract: vi.fn().mockResolvedValue(undefined),
    addContractHistoryEntry: vi.fn().mockResolvedValue({
      id: 'history-1',
      contractId: contract.contractId,
      kind: 'pendingActionRequested',
      short: 'Customer action requested.',
      createdAt: NOW,
    }),
  };

  const deps = {
    payNoteRepository,
    contractRepository,
    clock: {
      now: () => new Date(NOW),
    },
  } as unknown as HandleWebhookEventDependencies;

  return {
    deps,
    payNoteRepository,
    contractRepository,
  };
};

describe('handleCustomerActionRequestEvents', () => {
  it('skips duplicate customer action events when dedupe key is already processed', async () => {
    const contract = createContract();
    const { deps, payNoteRepository, contractRepository } =
      createDeps(contract);
    payNoteRepository.markEventProcessed.mockResolvedValue(false);
    const logs: Array<{
      level: 'info' | 'warn' | 'error';
      message: string;
      context?: Record<string, unknown>;
    }> = [];

    await handleCustomerActionRequestEvents({
      events: [
        {
          event: {
            type: 'Conversation/Customer Action Requested',
            title: 'Milestone 1',
            message: 'Confirm milestone 1 delivery.',
            actions: [{ label: 'Accept' }],
          } as any,
          eventType: 'Conversation/Customer Action Requested',
          eventIndex: 0,
        },
      ],
      eventId: 'event-duplicate',
      payNoteDocumentId: 'doc-1',
      sessionId: 'session-1',
      deps,
      logs,
    });

    expect(contractRepository.getContractBySessionId).not.toHaveBeenCalled();
    expect(contractRepository.saveContract).not.toHaveBeenCalled();
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'Skipped duplicate customer action request event',
      })
    );
  });

  it('stores customer action request with options-only actions', async () => {
    const contract = createContract();
    const { deps, contractRepository } = createDeps(contract);
    const logs: Array<{
      level: 'info' | 'warn' | 'error';
      message: string;
      context?: Record<string, unknown>;
    }> = [];

    await handleCustomerActionRequestEvents({
      events: [
        {
          event: {
            type: 'Conversation/Customer Action Requested',
            requestId: 'request-1',
            title: 'Milestone 1',
            message: 'Confirm milestone 1 delivery.',
            actions: [
              { label: 'Accept', variant: 'primary' },
              { label: 'Reject', variant: 'reject' },
            ],
          } as any,
          eventType: 'Conversation/Customer Action Requested',
          eventIndex: 0,
        },
      ],
      eventId: 'event-1',
      eventEpoch: 5,
      payNoteDocumentId: 'doc-1',
      sessionId: 'session-1',
      deps,
      logs,
    });

    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            actionId: 'customer-action:event-1:0',
            type: 'customerActionOptions',
            status: 'pending',
            title: 'Milestone 1',
            message: 'Confirm milestone 1 delivery.',
            requestId: 'request-1',
            minSummaryEpoch: 5,
            queueOrder: 5000000,
          }),
        ]),
      })
    );
  });

  it('stores customer action request with input schema as customerActionInput', async () => {
    const contract = createContract();
    const { deps, contractRepository } = createDeps(contract);

    await handleCustomerActionRequestEvents({
      events: [
        {
          event: {
            type: 'Conversation/Customer Action Requested',
            title: 'Milestone concern',
            message: 'Either accept milestone or describe concern.',
            actions: [
              { label: 'Accept', variant: 'primary' },
              {
                label: 'I have a concern',
                variant: 'secondary',
                description: 'Describe what is missing or incorrect.',
                inputRequired: false,
                inputSchema: { type: 'Text' },
                inputTitle: 'Tell us what is wrong',
              },
            ],
          } as any,
          eventType: 'Conversation/Customer Action Requested',
          eventIndex: 1,
        },
      ],
      eventId: 'event-2',
      payNoteDocumentId: 'doc-1',
      sessionId: 'session-1',
      deps,
      logs: [],
    });

    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            actionId: 'customer-action:event-2:1',
            type: 'customerActionInput',
            message: 'Either accept milestone or describe concern.',
            actions: expect.arrayContaining([
              expect.objectContaining({
                label: 'I have a concern',
                description: 'Describe what is missing or incorrect.',
                inputRequired: false,
                inputSchema: expect.any(Object),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('deduplicates customer action request by requestId', async () => {
    const contract = {
      ...createContract(),
      pendingActions: [
        {
          actionId: 'customer-action:event-existing:0',
          type: 'customerActionOptions' as const,
          status: 'pending' as const,
          title: 'Milestone 2',
          message: 'Confirm milestone 2 delivery.',
          actions: [{ label: 'Accept' }],
          requestId: 'request-2',
          createdAt: NOW,
        },
      ],
    };
    const { deps, contractRepository } = createDeps(contract);
    const logs: Array<{
      level: 'info' | 'warn' | 'error';
      message: string;
      context?: Record<string, unknown>;
    }> = [];

    await handleCustomerActionRequestEvents({
      events: [
        {
          event: {
            type: 'Conversation/Customer Action Requested',
            requestId: 'request-2',
            title: 'Milestone 2',
            message: 'Confirm milestone 2 delivery.',
            actions: [{ label: 'Accept' }],
          } as any,
          eventType: 'Conversation/Customer Action Requested',
          eventIndex: 4,
        },
      ],
      eventId: 'event-dup-request-id',
      payNoteDocumentId: 'doc-1',
      sessionId: 'session-1',
      deps,
      logs,
    });

    expect(contractRepository.saveContract).not.toHaveBeenCalled();
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'Customer action request deduplicated by request id',
      })
    );
  });

  it('rejects customer action request with duplicate labels', async () => {
    const contract = createContract();
    const { deps, contractRepository } = createDeps(contract);
    const logs: Array<{
      level: 'info' | 'warn' | 'error';
      message: string;
      context?: Record<string, unknown>;
    }> = [];

    await handleCustomerActionRequestEvents({
      events: [
        {
          event: {
            type: 'Conversation/Customer Action Requested',
            title: 'Duplicate labels',
            message: 'This request should be ignored.',
            actions: [{ label: 'Accept' }, { label: 'Accept' }],
          } as any,
          eventType: 'Conversation/Customer Action Requested',
          eventIndex: 2,
        },
      ],
      eventId: 'event-3',
      payNoteDocumentId: 'doc-1',
      sessionId: 'session-1',
      deps,
      logs,
    });

    expect(contractRepository.saveContract).not.toHaveBeenCalled();
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'Customer action request ignored (duplicate-action-label)',
      })
    );
  });

  it('rejects customer action request when message is missing', async () => {
    const contract = createContract();
    const { deps, contractRepository } = createDeps(contract);
    const logs: Array<{
      level: 'info' | 'warn' | 'error';
      message: string;
      context?: Record<string, unknown>;
    }> = [];

    await handleCustomerActionRequestEvents({
      events: [
        {
          event: {
            type: 'Conversation/Customer Action Requested',
            title: 'Missing message',
            actions: [{ label: 'Accept' }],
          } as any,
          eventType: 'Conversation/Customer Action Requested',
          eventIndex: 3,
        },
      ],
      eventId: 'event-4',
      payNoteDocumentId: 'doc-1',
      sessionId: 'session-1',
      deps,
      logs,
    });

    expect(contractRepository.saveContract).not.toHaveBeenCalled();
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'Customer action request ignored (missing message)',
      })
    );
  });
});
