import { describe, it, expect, vi } from 'vitest';
import {
  consumePendingPayNoteBootstrapEvents,
  handlePayNoteBootstrapWebhookEvent,
} from './handlePayNoteBootstrapWebhookEvent';
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

const buildPayNoteRequesterDocument = () => {
  const node = blue.yamlToNode(`name: Requesting PayNote
contracts:
  guarantorChannel:
    type: MyOS/MyOS Timeline Channel
  guarantorUpdate:
    type: Conversation/Operation
    channel: guarantorChannel`);
  node.setType(
    blue.jsonValueToNode({
      blueId: paynoteBlueIds['PayNote/PayNote'],
    })
  );
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const buildPaymentMandateDocument = () => {
  const node = blue.yamlToNode('name: Test Payment Mandate');
  node.setType(
    blue.jsonValueToNode({
      blueId: paynoteBlueIds['PayNote/Payment Mandate'],
    })
  );
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const buildPayNoteDeliveryDocument = () => {
  const node = blue.yamlToNode('name: Test PayNote Delivery');
  node.setType(
    blue.jsonValueToNode({
      blueId: paynoteBlueIds['PayNote/PayNote Delivery'],
    })
  );
  return blue.nodeToJson(node) as Record<string, unknown>;
};

const getDocumentOperationCalls = (myOsClient: {
  runDocumentOperation: unknown;
}): Array<{
  sessionId?: string;
  operation?: string;
  payload?: unknown;
}> =>
  (
    myOsClient.runDocumentOperation as {
      mock: {
        calls: Array<
          Array<{ sessionId?: string; operation?: string; payload?: unknown }>
        >;
      };
    }
  ).mock.calls.map(call => call[0]);

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
      finalizeEventProcessing: vi.fn(),
      releaseEventProcessing: vi.fn(),
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
  const bootstrapContextRepository: HandlePayNoteBootstrapWebhookDependencies['bootstrapContextRepository'] =
    {
      getContextBySessionId: vi.fn(),
      saveContext: vi.fn(),
    };
  const pendingBootstrapEventRepository: HandlePayNoteBootstrapWebhookDependencies['pendingBootstrapEventRepository'] =
    {
      addPending: vi.fn(),
      listPending: vi.fn(),
      deletePending: vi.fn(),
    };

  const contractRepository: HandlePayNoteBootstrapWebhookDependencies['contractRepository'] =
    {
      getContract: vi.fn(),
      getContractByDocumentId: vi.fn(),
      getContractBySessionId: vi.fn(),
      getContractSummarySnapshot: vi.fn(),
      saveContract: vi.fn(),
      saveContractSummarySnapshot: vi.fn(),
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
      bootstrapContextRepository,
      pendingBootstrapEventRepository,
      contractRepository,
      holdRepository,
      clock,
    } satisfies HandlePayNoteBootstrapWebhookDependencies,
    myOsClient,
    payNoteRepository,
    payNoteDeliveryRepository,
    payNoteBootstrapRepository,
    bootstrapContextRepository,
    pendingBootstrapEventRepository,
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
      bootstrapContextRepository,
      pendingBootstrapEventRepository,
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
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-1',
        merchantId: 'merchant-1',
        customerChannelKey: 'payerChannel',
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
        merchantId: 'merchant-1',
      })
    );
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        sessionId: 'session-1',
        accountNumber: 'acct-1',
        userId: 'user-1',
        customerChannelKey: 'payerChannel',
      })
    );
    expect(pendingBootstrapEventRepository.addPending).not.toHaveBeenCalled();
    expect(
      payNoteDeliveryRepository.finalizeEventProcessing
    ).toHaveBeenCalledWith('event-1');
    expect(
      payNoteDeliveryRepository.releaseEventProcessing
    ).not.toHaveBeenCalled();
  });

  it('releases event claim when bootstrap processing fails', async () => {
    const { deps, payNoteDeliveryRepository } = createDependencies();

    payNoteDeliveryRepository.markEventProcessed = vi
      .fn()
      .mockResolvedValue(true);
    payNoteDeliveryRepository.getDeliveryByBootstrapSessionId = vi
      .fn()
      .mockRejectedValue(new Error('delivery-read-error'));

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-failed-1',
      object: {
        sessionId: 'bootstrap-1',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('session-1')],
      },
    };

    await expect(
      handlePayNoteBootstrapWebhookEvent({ payload }, deps)
    ).rejects.toThrow('delivery-read-error');
    expect(
      payNoteDeliveryRepository.releaseEventProcessing
    ).toHaveBeenCalledWith('event-failed-1');
    expect(
      payNoteDeliveryRepository.finalizeEventProcessing
    ).not.toHaveBeenCalled();
  });

  it('reports bootstrap completion to requesting session using bootstrapped paynote document id', async () => {
    const {
      deps,
      myOsClient,
      payNoteRepository,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
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
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-complete-1',
        merchantId: 'merchant-1',
        accountNumber: '9559276001',
        userId: 'user-1',
        requestingSessionId: 'requesting-session-1',
        requestId: 'bootstrap-request-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    myOsClient.getCredentials = vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.example.com',
    });
    myOsClient.runDocumentOperation = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
    myOsClient.fetchDocument = vi.fn().mockImplementation(async sessionId => {
      if (sessionId === 'requesting-session-1') {
        return {
          kind: 'success',
          document: {
            documentId: 'requesting-paynote-doc-1',
            sessionId: 'requesting-session-1',
            document: buildPayNoteRequesterDocument(),
          },
        } as MyOsFetchDocumentResult;
      }
      return {
        kind: 'success',
        document: {
          documentId: 'target-paynote-doc-1',
          sessionId: 'target-session-1',
          document: buildPayNoteDocument(),
        },
      } as MyOsFetchDocumentResult;
    });
    payNoteRepository.getPayNote = vi.fn().mockResolvedValue(null);

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-bootstrap-complete-1',
      object: {
        sessionId: 'bootstrap-complete-1',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('target-session-1')],
        created: '2024-01-01T00:00:00.000Z',
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    const guarantorUpdateCall = getDocumentOperationCalls(myOsClient).find(
      call => call.operation === 'guarantorUpdate'
    );
    expect(guarantorUpdateCall).toBeDefined();
    expect(guarantorUpdateCall).toEqual(
      expect.objectContaining({
        sessionId: 'requesting-session-1',
        operation: 'guarantorUpdate',
      })
    );
    const payloadJson = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payloadJson).toContain('Conversation/Document Bootstrap Completed');
    expect(payloadJson).toContain('target-paynote-doc-1');
    expect(payloadJson).toContain('bootstrap-request-1');
  });

  it('skips bootstrap completion guarantorUpdate for paynote delivery requester', async () => {
    const {
      deps,
      myOsClient,
      payNoteRepository,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
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
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-complete-delivery-1',
        merchantId: 'merchant-1',
        accountNumber: '9559276001',
        userId: 'user-1',
        requestingSessionId: 'delivery-requesting-session-1',
        requestId: 'bootstrap-request-delivery-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    myOsClient.getCredentials = vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.example.com',
    });
    myOsClient.runDocumentOperation = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
    myOsClient.fetchDocument = vi.fn().mockImplementation(async sessionId => {
      if (sessionId === 'delivery-requesting-session-1') {
        return {
          kind: 'success',
          document: {
            documentId: 'delivery-doc-1',
            sessionId,
            document: buildPayNoteDeliveryDocument(),
          },
        } as MyOsFetchDocumentResult;
      }
      return {
        kind: 'success',
        document: {
          documentId: 'target-paynote-doc-delivery-1',
          sessionId,
          document: buildPayNoteDocument(),
        },
      } as MyOsFetchDocumentResult;
    });
    payNoteRepository.getPayNote = vi.fn().mockResolvedValue(null);

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-bootstrap-complete-delivery-1',
      object: {
        sessionId: 'bootstrap-complete-delivery-1',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('target-session-delivery-1')],
        created: '2024-01-01T00:00:00.000Z',
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    const guarantorUpdateCall = getDocumentOperationCalls(myOsClient).find(
      call => call.operation === 'guarantorUpdate'
    );
    expect(guarantorUpdateCall).toBeUndefined();
  });

  it('skips bootstrap completion guarantorUpdate for non-paynote requester', async () => {
    const {
      deps,
      myOsClient,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
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
      .mockResolvedValue(null);
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-mandate-1',
        merchantId: 'merchant-1',
        accountNumber: 'acct-1',
        userId: 'user-1',
        requestingSessionId: 'requesting-session-1',
        requestId: 'mandate-bootstrap-request-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    myOsClient.getCredentials = vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.example.com',
    });
    myOsClient.runDocumentOperation = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
    myOsClient.fetchDocument = vi.fn().mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'target-mandate-doc-1',
        sessionId: 'target-mandate-session-1',
        document: buildPaymentMandateDocument(),
      },
    } as MyOsFetchDocumentResult);

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-bootstrap-mandate-complete-1',
      object: {
        sessionId: 'bootstrap-mandate-1',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('target-mandate-session-1')],
        created: '2024-01-01T00:00:00.000Z',
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    expect(deps.payNoteRepository.savePayNote).not.toHaveBeenCalled();
    const guarantorUpdateCall = getDocumentOperationCalls(myOsClient).find(
      call => call.operation === 'guarantorUpdate'
    );
    expect(guarantorUpdateCall).toBeUndefined();
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'target-mandate-doc-1',
        sessionId: 'target-mandate-session-1',
      })
    );
  });

  it('skips bootstrap completion guarantorUpdate when requesting document cannot be resolved', async () => {
    const {
      deps,
      myOsClient,
      payNoteRepository,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
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
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-complete-missing-requester-1',
        merchantId: 'merchant-1',
        accountNumber: '9559276001',
        userId: 'user-1',
        requestingSessionId: 'requesting-session-missing-1',
        requestId: 'bootstrap-request-missing-requester-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    myOsClient.getCredentials = vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.example.com',
    });
    myOsClient.runDocumentOperation = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
    myOsClient.fetchDocument = vi.fn().mockImplementation(async sessionId => {
      if (sessionId === 'requesting-session-missing-1') {
        return {
          kind: 'not-found',
          status: 404,
        } as MyOsFetchDocumentResult;
      }

      return {
        kind: 'success',
        document: {
          documentId: 'target-paynote-doc-missing-requester-1',
          sessionId,
          document: buildPayNoteDocument(),
        },
      } as MyOsFetchDocumentResult;
    });
    payNoteRepository.getPayNote = vi.fn().mockResolvedValue(null);

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-bootstrap-complete-missing-requester-1',
      object: {
        sessionId: 'bootstrap-complete-missing-requester-1',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('target-session-missing-1')],
        created: '2024-01-01T00:00:00.000Z',
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    const guarantorUpdateCall = getDocumentOperationCalls(myOsClient).find(
      call => call.operation === 'guarantorUpdate'
    );
    expect(guarantorUpdateCall).toBeUndefined();
  });

  it('propagates payment mandate attachment to linked paynote sessions after mandate bootstrap', async () => {
    const {
      deps,
      myOsClient,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
      contractRepository,
    } = createDependencies();

    payNoteDeliveryRepository.markEventProcessed = vi
      .fn()
      .mockResolvedValue(true);
    payNoteDeliveryRepository.getDeliveryByBootstrapSessionId = vi
      .fn()
      .mockResolvedValue({
        deliveryId: 'delivery-1',
        paymentMandateBootstrapSessionId: 'bootstrap-mandate-attach-1',
        paymentMandateStatus: 'pending',
        payNoteSessionIds: ['paynote-session-attach-1'],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
    payNoteBootstrapRepository.getBootstrapBySessionId = vi
      .fn()
      .mockResolvedValue(null);
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue(null);
    myOsClient.fetchDocument = vi.fn().mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'target-mandate-doc-attach-1',
        sessionId: 'target-mandate-session-attach-1',
        document: buildPaymentMandateDocument(),
      },
    } as MyOsFetchDocumentResult);
    myOsClient.getCredentials = vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.example.com',
    });
    myOsClient.runDocumentOperation = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-bootstrap-mandate-attach-1',
      object: {
        sessionId: 'bootstrap-mandate-attach-1',
        document: buildBootstrapDocument(),
        emitted: [
          buildTargetSessionStartedEvent('target-mandate-session-attach-1'),
        ],
        created: '2024-01-01T00:00:00.000Z',
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    expect(payNoteDeliveryRepository.saveDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        paymentMandateDocumentId: 'target-mandate-doc-attach-1',
        paymentMandateStatus: 'attached',
      })
    );

    const guarantorUpdateCall = getDocumentOperationCalls(myOsClient).find(
      call =>
        call.operation === 'guarantorUpdate' &&
        call.sessionId === 'paynote-session-attach-1'
    );
    expect(guarantorUpdateCall).toBeDefined();
    const payloadJson = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payloadJson).toContain('PayNote/Payment Mandate Attached');
    expect(payloadJson).toContain('target-mandate-doc-attach-1');
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'target-mandate-doc-attach-1',
        sessionId: 'target-mandate-session-attach-1',
      })
    );
  });

  it('emits payment mandate attachment when paynote links after mandate was already attached', async () => {
    const {
      deps,
      myOsClient,
      payNoteRepository,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
    } = createDependencies();

    payNoteDeliveryRepository.markEventProcessed = vi
      .fn()
      .mockResolvedValue(true);
    payNoteDeliveryRepository.getDeliveryByBootstrapSessionId = vi
      .fn()
      .mockResolvedValue({
        deliveryId: 'delivery-2',
        paymentMandateDocumentId: 'mandate-doc-attached-2',
        paymentMandateStatus: 'attached',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
    payNoteBootstrapRepository.getBootstrapBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-paynote-attach-2',
        userId: 'user-2',
        accountNumber: 'acct-2',
        payerAccountNumber: 'acct-2',
        payeeAccountNumber: 'acct-3',
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue(null);
    myOsClient.fetchDocument = vi.fn().mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'target-paynote-doc-attach-2',
        sessionId: 'target-paynote-session-attach-2',
        document: buildPayNoteDocument(),
      },
    } as MyOsFetchDocumentResult);
    payNoteRepository.getPayNote = vi.fn().mockResolvedValue(null);
    myOsClient.getCredentials = vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.example.com',
    });
    myOsClient.runDocumentOperation = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-bootstrap-paynote-attach-2',
      object: {
        sessionId: 'bootstrap-paynote-attach-2',
        document: buildBootstrapDocument(),
        emitted: [
          buildTargetSessionStartedEvent('target-paynote-session-attach-2'),
        ],
        created: '2024-01-01T00:00:00.000Z',
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    const guarantorUpdateCall = getDocumentOperationCalls(myOsClient).find(
      call =>
        call.operation === 'guarantorUpdate' &&
        call.sessionId === 'target-paynote-session-attach-2'
    );
    expect(guarantorUpdateCall).toBeDefined();
    const payloadJson = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payloadJson).toContain('PayNote/Payment Mandate Attached');
    expect(payloadJson).toContain('mandate-doc-attached-2');
  });

  it('omits inResponseTo for completion when requestId is not provided', async () => {
    const {
      deps,
      myOsClient,
      payNoteRepository,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
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
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-complete-2',
        merchantId: 'merchant-1',
        accountNumber: '9559276001',
        userId: 'user-2',
        requestingSessionId: 'requesting-session-2',
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    myOsClient.getCredentials = vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'bank-account',
      baseUrl: 'https://myos.example.com',
    });
    myOsClient.runDocumentOperation = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
    myOsClient.fetchDocument = vi.fn().mockImplementation(async sessionId => {
      if (sessionId === 'requesting-session-2') {
        return {
          kind: 'success',
          document: {
            documentId: 'requesting-paynote-doc-2',
            sessionId: 'requesting-session-2',
            document: buildPayNoteRequesterDocument(),
          },
        } as MyOsFetchDocumentResult;
      }
      return {
        kind: 'success',
        document: {
          documentId: 'target-paynote-doc-2',
          sessionId: 'target-session-2',
          document: buildPayNoteDocument(),
        },
      } as MyOsFetchDocumentResult;
    });
    payNoteRepository.getPayNote = vi.fn().mockResolvedValue(null);

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-bootstrap-complete-2',
      object: {
        sessionId: 'bootstrap-complete-2',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('target-session-2')],
        created: '2024-01-01T00:00:00.000Z',
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    const guarantorUpdateCall = getDocumentOperationCalls(myOsClient).find(
      call => call.operation === 'guarantorUpdate'
    );
    expect(guarantorUpdateCall).toBeDefined();
    const payloadJson = JSON.stringify(guarantorUpdateCall?.payload);
    expect(payloadJson).toContain('Conversation/Document Bootstrap Completed');
    expect(payloadJson).toContain('target-paynote-doc-2');
    expect(payloadJson).not.toContain('inResponseTo');
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

  it('buffers when no matching bootstrap context is found', async () => {
    const {
      deps,
      myOsClient,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      pendingBootstrapEventRepository,
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
    expect(result.note).toBe('Buffered waiting for bootstrap context');
    expect(myOsClient.fetchDocument).not.toHaveBeenCalled();
    expect(pendingBootstrapEventRepository.addPending).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapSessionId: 'bootstrap-4',
        eventId: 'event-4',
      })
    );
  });

  it('buffers when bootstrap context exists but linking data is missing', async () => {
    const {
      deps,
      myOsClient,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
      pendingBootstrapEventRepository,
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
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-5',
        merchantId: 'merchant-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-5',
      object: {
        sessionId: 'bootstrap-5',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('session-5')],
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    expect(result.note).toBe('Buffered waiting for bootstrap context');
    expect(myOsClient.fetchDocument).not.toHaveBeenCalled();
    expect(pendingBootstrapEventRepository.addPending).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapSessionId: 'bootstrap-5',
        eventId: 'event-5',
      })
    );
  });

  it('links paynote using bootstrap context when delivery/bootstrap records are missing', async () => {
    const {
      deps,
      myOsClient,
      payNoteRepository,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
      pendingBootstrapEventRepository,
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
      .mockResolvedValue(null);
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-ctx-1',
        merchantId: 'merchant-ctx-1',
        accountNumber: '9559276001',
        userId: 'user-ctx-1',
        holdId: 'hold-ctx-1',
        transactionId: 'txn-ctx-1',
        payeeAccountNumber: '9559276001',
        customerChannelKey: 'payerChannel',
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    myOsClient.fetchDocument = vi.fn().mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-ctx-1',
        sessionId: 'session-ctx-1',
        document: buildPayNoteDocument(),
      },
    } as MyOsFetchDocumentResult);
    payNoteRepository.getPayNote = vi.fn().mockResolvedValue(null);

    const payload: HandlePayNoteBootstrapWebhookInput['payload'] = {
      id: 'event-ctx-1',
      object: {
        sessionId: 'bootstrap-ctx-1',
        document: buildBootstrapDocument(),
        emitted: [buildTargetSessionStartedEvent('session-ctx-1')],
        created: '2024-01-01T00:00:00.000Z',
      },
    };

    const result = await handlePayNoteBootstrapWebhookEvent({ payload }, deps);

    expect(result.handled).toBe(true);
    expect(result.note).toBeUndefined();
    expect(pendingBootstrapEventRepository.addPending).not.toHaveBeenCalled();
    expect(payNoteRepository.savePayNote).toHaveBeenCalledWith(
      expect.objectContaining({
        payNoteDocumentId: 'doc-ctx-1',
        sessionIds: ['session-ctx-1'],
        accountNumber: '9559276001',
        userId: 'user-ctx-1',
        merchantId: 'merchant-ctx-1',
        holdId: 'hold-ctx-1',
        transactionId: 'txn-ctx-1',
        payeeAccountNumber: '9559276001',
      })
    );
    const savedPayNote = (
      payNoteRepository.savePayNote as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls[0]?.[0];
    expect(savedPayNote?.payerAccountNumber).toBeUndefined();
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-ctx-1',
        sessionId: 'session-ctx-1',
        accountNumber: '9559276001',
        userId: 'user-ctx-1',
        customerChannelKey: 'payerChannel',
      })
    );
  });

  it('consumes pending bootstrap events when context exists', async () => {
    const {
      deps,
      myOsClient,
      payNoteRepository,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      bootstrapContextRepository,
      pendingBootstrapEventRepository,
      contractRepository,
    } = createDependencies();

    pendingBootstrapEventRepository.listPending = vi.fn().mockResolvedValue([
      {
        bootstrapSessionId: 'bootstrap-1',
        eventId: 'event-pending-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    pendingBootstrapEventRepository.deletePending = vi
      .fn()
      .mockResolvedValue(undefined);
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
    bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockResolvedValue({
        bootstrapSessionId: 'bootstrap-1',
        merchantId: 'merchant-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      });
    myOsClient.fetchEvent = vi.fn().mockResolvedValue({
      kind: 'success',
      payload: {
        id: 'event-pending-1',
        object: {
          sessionId: 'bootstrap-1',
          document: buildBootstrapDocument(),
          emitted: [buildTargetSessionStartedEvent('session-1')],
          created: '2024-01-01T00:00:00.000Z',
        },
      },
    });
    myOsClient.fetchDocument = vi.fn().mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: buildPayNoteDocument(),
      },
    } as MyOsFetchDocumentResult);
    payNoteRepository.getPayNote = vi.fn().mockResolvedValue(null);

    const result = await consumePendingPayNoteBootstrapEvents(
      { bootstrapSessionId: 'bootstrap-1' },
      deps
    );

    expect(result.handled).toBe(true);
    expect(result.consumedCount).toBe(1);
    expect(result.remainingCount).toBe(0);
    expect(pendingBootstrapEventRepository.deletePending).toHaveBeenCalledWith({
      bootstrapSessionId: 'bootstrap-1',
      eventId: 'event-pending-1',
    });
    expect(contractRepository.saveContract).toHaveBeenCalled();
  });

  it('keeps pending bootstrap event when context is still missing', async () => {
    const {
      deps,
      myOsClient,
      payNoteDeliveryRepository,
      payNoteBootstrapRepository,
      pendingBootstrapEventRepository,
    } = createDependencies();

    pendingBootstrapEventRepository.listPending = vi.fn().mockResolvedValue([
      {
        bootstrapSessionId: 'bootstrap-1',
        eventId: 'event-pending-2',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    payNoteDeliveryRepository.getDeliveryByBootstrapSessionId = vi
      .fn()
      .mockResolvedValue(null);
    payNoteBootstrapRepository.getBootstrapBySessionId = vi
      .fn()
      .mockResolvedValue(null);
    myOsClient.fetchEvent = vi.fn().mockResolvedValue({
      kind: 'success',
      payload: {
        id: 'event-pending-2',
        object: {
          sessionId: 'bootstrap-1',
          document: buildBootstrapDocument(),
          emitted: [buildTargetSessionStartedEvent('session-1')],
        },
      },
    });

    const result = await consumePendingPayNoteBootstrapEvents(
      { bootstrapSessionId: 'bootstrap-1' },
      deps
    );

    expect(result.handled).toBe(true);
    expect(result.consumedCount).toBe(0);
    expect(result.remainingCount).toBe(1);
    expect(
      pendingBootstrapEventRepository.deletePending
    ).not.toHaveBeenCalled();
  });
});
