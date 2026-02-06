import { describe, it, expect, vi } from 'vitest';
import { handlePayNoteBootstrapWebhookEvent } from './handlePayNoteBootstrapWebhookEvent';
import myosBlueIds from '@blue-repository/types/packages/myos/blue-ids';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import { blue } from '../../blue';
import type {
  HandlePayNoteBootstrapWebhookDependencies,
  HandlePayNoteBootstrapWebhookInput,
} from './handlePayNoteBootstrapWebhookEvent';
import type { MyOsFetchDocumentResult } from '../ports';

const buildBootstrapDocument = () => {
  const node = blue.yamlToNode('name: Bootstrap');
  node.setType(
    blue.jsonValueToNode({
      blueId: myosBlueIds['MyOS/Document Session Bootstrap'],
    })
  );
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const buildTargetSessionStartedEvent = (sessionId: string) => {
  const node = blue.yamlToNode(
    `initiatorSessionIds:\n  - ${sessionId}\nname: Target Session Started`
  );
  node.setType(
    blue.jsonValueToNode({
      blueId: myosBlueIds['MyOS/Target Document Session Started'],
    })
  );
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const buildPayNoteDocument = () => {
  const node = blue.yamlToNode('name: Test PayNote');
  node.setType(
    blue.jsonValueToNode({
      blueId: paynoteBlueIds['PayNote/PayNote'],
    })
  );
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const createDependencies = () => {
  const myOsClient: HandlePayNoteBootstrapWebhookDependencies['myOsClient'] = {
    getCredentials: vi.fn(),
    bootstrapDocument: vi.fn(),
    runDocumentOperation: vi.fn(),
    fetchEvent: vi.fn(),
    fetchDocument: vi.fn(),
  };

  const payNoteRepository: HandlePayNoteBootstrapWebhookDependencies['payNoteRepository'] =
    {
      getPayNote: vi.fn(),
      getPayNoteBySessionId: vi.fn(),
      savePayNote: vi.fn(),
      markEventProcessed: vi.fn().mockResolvedValue(true),
    };

  const payNoteDeliveryRepository: HandlePayNoteBootstrapWebhookDependencies['payNoteDeliveryRepository'] =
    {
      markEventProcessed: vi.fn(),
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: vi.fn(),
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
      updateDeliverySummary: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
    };

  const payNoteBootstrapRepository: HandlePayNoteBootstrapWebhookDependencies['payNoteBootstrapRepository'] =
    {
      getBootstrapBySessionId: vi.fn(),
      saveBootstrap: vi.fn(),
    };

  const contractRepository: HandlePayNoteBootstrapWebhookDependencies['contractRepository'] =
    {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi.fn(),
      saveContract: vi.fn(),
      markSummaryEventProcessed: vi.fn().mockResolvedValue(true),
      addContractHistoryEntry: vi.fn(),
      listContractHistory: vi.fn(),
      updateContractArchive: vi.fn(),
      updateContractSummary: vi.fn(),
      listContractsByUserId: vi.fn(),
      listContractsByTransactionId: vi.fn(),
      listContractsByHoldId: vi.fn(),
    };

  const holdRepository: HandlePayNoteBootstrapWebhookDependencies['holdRepository'] =
    {
      getHold: vi.fn(),
      putHoldMeta: vi.fn(),
    } as unknown as HandlePayNoteBootstrapWebhookDependencies['holdRepository'];

  const clock = { now: () => new Date('2024-01-01T00:00:00.000Z') };

  return {
    deps: {
      myOsClient,
      payNoteRepository,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      contractRepository,
      holdRepository,
      clock,
    } satisfies HandlePayNoteBootstrapWebhookDependencies,
    myOsClient,
    payNoteRepository,
    payNoteDeliveryRepository,
    payNoteBootstrapRepository,
    contractRepository,
  };
};

describe('handlePayNoteBootstrapWebhookEvent', () => {
  it('links PayNote records when bootstrap target session is resolved', async () => {
    const {
      deps,
      myOsClient,
      payNoteRepository,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      contractRepository,
    } = createDependencies();

    payNoteDeliveryRepository.markEventProcessed = vi
      .fn()
      .mockResolvedValue(true);
    payNoteDeliveryRepository.getDeliveryByBootstrapSessionId = vi
      .fn()
      .mockResolvedValue(null);
    payNoteBootstrapRepository.getBootstrapBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-1',
        userId: 'user-1',
        accountNumber: 'acct-1',
        payerAccountNumber: 'acct-1',
        payeeAccountNumber: 'acct-2',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

    const payNoteDocument = buildPayNoteDocument();
    myOsClient.fetchDocument = vi.fn().mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: payNoteDocument,
      },
    } as MyOsFetchDocumentResult);
    payNoteRepository.getPayNote = vi.fn().mockResolvedValue(null);

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-1',
      object: {
        sessionId: 'bootstrap-1',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('session-1')],
        created: '2024-01-01T00:00:00.000Z',
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    expect(payNoteRepository.savePayNote).toHaveBeenCalledWith(
      expect.objectContaining({
        payNoteDocumentId: 'doc-1',
        sessionIds: ['session-1'],
        userId: 'user-1',
        accountNumber: 'acct-1',
        payerAccountNumber: 'acct-1',
        payeeAccountNumber: 'acct-2',
      })
    );
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        sessionId: 'session-1',
        accountNumber: 'acct-1',
        userId: 'user-1',
      })
    );
  });

  it('skips non-bootstrap payloads', async () => {
    const { deps, payNoteDeliveryRepository } = createDependencies();

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-2',
      object: {
        sessionId: 'session-2',
        document: buildPayNoteDocument(),
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(false);
    expect(payNoteDeliveryRepository.markEventProcessed).not.toHaveBeenCalled();
  });

  it('returns handled when event already processed', async () => {
    const { deps, payNoteDeliveryRepository, payNoteBootstrapRepository } =
      createDependencies();

    payNoteDeliveryRepository.markEventProcessed = vi
      .fn()
      .mockResolvedValue(false);

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-3',
      object: {
        sessionId: 'bootstrap-3',
        document: buildBootstrapDocument(),
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    expect(
      payNoteBootstrapRepository.getBootstrapBySessionId
    ).not.toHaveBeenCalled();
  });

  it('short-circuits when no matching bootstrap context is found', async () => {
    const {
      deps,
      myOsClient,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
    } = createDependencies();

    payNoteDeliveryRepository.markEventProcessed = vi
      .fn()
      .mockResolvedValue(true);
    payNoteDeliveryRepository.getDeliveryByBootstrapSessionId = vi
      .fn()
      .mockResolvedValue(null);
    payNoteBootstrapRepository.getBootstrapBySessionId = vi
      .fn()
      .mockResolvedValue(null);

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-4',
      object: {
        sessionId: 'bootstrap-4',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('session-4')],
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    expect(myOsClient.fetchDocument).not.toHaveBeenCalled();
  });
});
