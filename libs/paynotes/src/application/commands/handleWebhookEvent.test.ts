import { describe, it, expect, vi } from 'vitest';
import { handleWebhookEvent } from './handleWebhookEvent';
import type { HandleWebhookEventDependencies } from './handleWebhookEvent';
import type { MyOsFetchEventResult, MyOsFetchDocumentResult } from '../ports';
import { blue } from '../../blue';

const resolveTypeBlueId = (typeLabel: string): string => {
  const simple = blue.nodeToJson(
    blue.jsonValueToNode({ type: typeLabel }),
    'simple'
  ) as { type?: { blueId?: string } } | null;
  const blueId = simple?.type?.blueId;
  if (typeof blueId !== 'string' || blueId.length === 0) {
    throw new Error(`Unable to resolve BlueId for type ${typeLabel}`);
  }
  return blueId;
};

const expectGuarantorUpdatePayloadEvent = (
  payload: unknown,
  eventType: string
) => {
  const simplePayload = blue.nodeToJson(
    blue.jsonValueToNode(payload),
    'simple'
  );
  expect(Array.isArray(simplePayload)).toBe(true);

  const payloadArray = simplePayload as Array<{
    type?: { blueId?: string };
  }>;

  expect(payloadArray).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: expect.objectContaining({
          blueId: resolveTypeBlueId(eventType),
        }),
      }),
    ])
  );
};

const parseGuarantorUpdatePayloadEvents = (
  payload: unknown
): Array<Record<string, unknown>> => {
  const simplePayload = blue.nodeToJson(
    blue.jsonValueToNode(payload),
    'simple'
  );
  expect(Array.isArray(simplePayload)).toBe(true);
  return simplePayload as Array<Record<string, unknown>>;
};

const toOfficialBlue = <T>(value: T): T =>
  blue.nodeToJson(blue.jsonValueToNode(value), {
    format: 'official',
  }) as T;

const createDependencies = () => {
  const fetchEvent = vi
    .fn<HandleWebhookEventDependencies['myOsClient']['fetchEvent']>()
    .mockResolvedValue({
      kind: 'success',
      payload: {
        object: {
          document: { type: 'PayNote/PayNote' },
          sessionId: 'session-1',
        },
      },
    } as MyOsFetchEventResult);

  const fetchDocument = vi
    .fn<HandleWebhookEventDependencies['myOsClient']['fetchDocument']>()
    .mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: { type: 'PayNote/PayNote' },
      },
    } as MyOsFetchDocumentResult);

  const myOsClient: HandleWebhookEventDependencies['myOsClient'] = {
    getCredentials: vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'https://example.test',
    }),
    bootstrapDocument: vi.fn(),
    runDocumentOperation: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }),
    fetchEvent,
    fetchDocument,
  };

  const bankingFacade: HandleWebhookEventDependencies['bankingFacade'] = {
    getAccountByNumber: vi.fn().mockResolvedValue({
      id: 'account-id',
      accountNumber: '1234567890',
      ownerUserId: 'user-123',
    }),
    getAccountForUser: vi.fn(),
    transferFunds: vi.fn(),
    reserveFunds: vi.fn(),
    captureHold: vi.fn().mockResolvedValue({
      holdId: 'hold-1',
    }),
  };

  const payNoteRepository: HandleWebhookEventDependencies['payNoteRepository'] =
    {
      getPayNote: vi.fn().mockResolvedValue(null),
      getPayNoteBySessionId: vi.fn().mockResolvedValue(null),
      savePayNote: vi.fn(),
      markEventProcessed: vi.fn().mockImplementation(async () => true),
    };

  const bootstrapContextRepository: HandleWebhookEventDependencies['bootstrapContextRepository'] =
    {
      getContextBySessionId: vi.fn().mockResolvedValue(null),
      saveContext: vi.fn(),
    };

  const holdRepository: HandleWebhookEventDependencies['holdRepository'] = {
    getHold: vi.fn().mockResolvedValue(null),
    getHoldByCardTransactionDetails: vi.fn().mockResolvedValue(null),
    disableHoldCapture: vi.fn().mockResolvedValue(null),
    enableHoldCapture: vi.fn().mockResolvedValue(null),
  } as any;

  const payNoteDeliveryRepository: HandleWebhookEventDependencies['payNoteDeliveryRepository'] =
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

  const contractRepository: HandleWebhookEventDependencies['contractRepository'] =
    {
      getContract: vi.fn().mockResolvedValue(null),
      getContractBySessionId: vi.fn().mockResolvedValue(null),
      getContractByDocumentId: vi.fn().mockResolvedValue(null),
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

  const clock = { now: () => new Date('2024-01-01T00:00:00.000Z') };

  return {
    deps: {
      myOsClient,
      bankingFacade,
      holdRepository,
      payNoteRepository,
      payNoteDeliveryRepository,
      bootstrapContextRepository,
      contractRepository,
      clock,
    } satisfies HandleWebhookEventDependencies,
    fetchEvent,
    fetchDocument,
  };
};

describe('handleWebhookEvent', () => {
  it('returns error note when event not found', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'not-found',
      status: 404,
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('Failed to download PayNote event from MyOS');
    expect(result.logs[0]?.level).toBe('error');
  });

  it('stores paynote record when payload resolves', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Test PayNote',
          },
          emitted: [],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(Array.isArray(result.logs)).toBe(true);
    expect(deps.bankingFacade.getAccountByNumber).not.toHaveBeenCalled();
    expect(deps.payNoteRepository.savePayNote).toHaveBeenCalledWith(
      expect.objectContaining({
        payNoteDocumentId: 'doc-1',
        payerAccountNumber: '1234567890',
      })
    );
  });

  it('adds transaction relationship after capture hold succeeds', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Capture Funds Requested',
              amount: 1200,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);

    deps.bankingFacade.captureHold = vi.fn().mockResolvedValue({
      holdId: 'doc-1',
      relatedTransactionId: 'txn-1',
    } as any);

    await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(deps.contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedTransactionIds: ['txn-1'],
      })
    );
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Funds Captured');
  });

  it('handles card transaction capture lock request without payer account', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: { type: 'PayNote/PayNote', name: 'Slow Digestion PayNote' },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Card Transaction Capture Lock Requested',
              requestId: 'capture-lock-1',
              cardTransactionDetails: {
                authorizationCode: 'AUTH01',
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.holdRepository.getHold as any).mockResolvedValue({
      holdId: 'hold-1',
      payerAccountNumber: '955',
      amountMinor: 12000,
      currency: 'USD',
      status: 'PENDING',
      cardTransactionDetails: {
        retrievalReferenceNumber: '111111111111',
        systemTraceAuditNumber: '222222',
        transmissionDateTime: '0101000000',
        authorizationCode: 'AUTH01',
      },
      captureDisabled: false,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.holdRepository.disableHoldCapture as any).mockResolvedValue({
      holdId: 'hold-1',
      payerAccountNumber: '955',
      amountMinor: 12000,
      currency: 'USD',
      status: 'PENDING',
      cardTransactionDetails: {
        retrievalReferenceNumber: '111111111111',
        systemTraceAuditNumber: '222222',
        transmissionDateTime: '0101000000',
        authorizationCode: 'AUTH01',
      },
      captureDisabled: true,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.getAccountByNumber).not.toHaveBeenCalled();
    expect(deps.holdRepository.disableHoldCapture).toHaveBeenCalledWith(
      'hold-1'
    );
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(
      payload,
      'PayNote/Card Transaction Capture Locked'
    );
    const responseEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(responseEvents[0]).toEqual(
      expect.objectContaining({
        inResponseTo: expect.objectContaining({
          requestId: 'capture-lock-1',
        }),
      })
    );
  });

  it('confirms capture lock when hold is already locked locally', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: { type: 'PayNote/PayNote', name: 'Slow Digestion PayNote' },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Card Transaction Capture Lock Requested',
              cardTransactionDetails: {
                authorizationCode: 'AUTH01',
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
      lastCaptureLockEventId: 'previous-lock',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.holdRepository.getHold as any).mockResolvedValue({
      holdId: 'hold-1',
      payerAccountNumber: '955',
      amountMinor: 12000,
      currency: 'USD',
      status: 'PENDING',
      cardTransactionDetails: {
        retrievalReferenceNumber: '111111111111',
        systemTraceAuditNumber: '222222',
        transmissionDateTime: '0101000000',
        authorizationCode: 'AUTH01',
      },
      captureDisabled: true,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.myOsClient.runDocumentOperation as any).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.holdRepository.disableHoldCapture).not.toHaveBeenCalled();
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(
      payload,
      'PayNote/Card Transaction Capture Locked'
    );
  });

  it('reports capture unlock via guarantorUpdate when unlock request is valid', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: { type: 'PayNote/PayNote', name: 'Slow Digestion PayNote' },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Card Transaction Capture Unlock Requested',
              cardTransactionDetails: {
                authorizationCode: 'AUTH01',
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.holdRepository.getHold as any).mockResolvedValue({
      holdId: 'hold-1',
      payerAccountNumber: '955',
      amountMinor: 12000,
      currency: 'USD',
      status: 'PENDING',
      cardTransactionDetails: {
        retrievalReferenceNumber: '111111111111',
        systemTraceAuditNumber: '222222',
        transmissionDateTime: '0101000000',
        authorizationCode: 'AUTH01',
      },
      captureDisabled: true,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.holdRepository.enableHoldCapture as any).mockResolvedValue({
      holdId: 'hold-1',
      payerAccountNumber: '955',
      amountMinor: 12000,
      currency: 'USD',
      status: 'PENDING',
      cardTransactionDetails: {
        retrievalReferenceNumber: '111111111111',
        systemTraceAuditNumber: '222222',
        transmissionDateTime: '0101000000',
        authorizationCode: 'AUTH01',
      },
      captureDisabled: false,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.myOsClient.runDocumentOperation as any).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.holdRepository.enableHoldCapture).toHaveBeenCalledWith(
      'hold-1'
    );
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(
      payload,
      'PayNote/Card Transaction Capture Unlocked'
    );
    const responseEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(responseEvents[0]).not.toHaveProperty('inResponseTo');
  });

  it('transfers funds when capture immediately is requested', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Quick PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reserve Funds and Capture Immediately Requested',
              requestId: 'capture-now-1',
              amount: 2500,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);

    await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(deps.bankingFacade.transferFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccountId: 'account-id',
        destinationAccountNumber: '9876543210',
        amountMinor: 2500,
        description: 'Quick PayNote',
        userId: 'user-123',
        payNoteDocumentId: 'doc-1',
      })
    );
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Funds Captured');
    const simpleEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(JSON.stringify(simpleEvents)).toContain('capture-now-1');
    expect(JSON.stringify(simpleEvents)).toContain('amountCaptured');
  });

  it('reports capture failed via guarantorUpdate when capture immediately transfer fails', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Quick PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reserve Funds and Capture Immediately Requested',
              requestId: 'capture-now-fail-1',
              amount: 2500,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);
    deps.bankingFacade.transferFunds = vi
      .fn()
      .mockRejectedValue(new Error('Transfer blocked'));

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Capture Failed');
    const simpleEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(JSON.stringify(simpleEvents)).toContain('capture-now-fail-1');
    expect(JSON.stringify(simpleEvents)).toContain('Transfer blocked');
  });

  it('uses existing paynote accountNumber as payer mapping fallback', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      accountNumber: '1234567890',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payeeAccountNumber: { value: '9876543210' },
            name: 'Quick PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reserve Funds and Capture Immediately Requested',
              requestId: 'capture-now-fallback-1',
              amount: 2500,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.getAccountByNumber).toHaveBeenCalledWith(
      '1234567890'
    );
    expect(deps.bankingFacade.transferFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccountId: 'account-id',
        destinationAccountNumber: '9876543210',
        amountMinor: 2500,
      })
    );
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Funds Captured');
  });

  it('reports funds reserved via guarantorUpdate when reserve request is valid', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Reserve PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reserve Funds Requested',
              requestId: 'reserve-1',
              amount: 3300,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'doc-1',
        amountMinor: 3300,
        payNoteDocumentId: 'doc-1',
      })
    );
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Funds Reserved');
    const simpleEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(JSON.stringify(simpleEvents)).toContain('reserve-1');
    expect(JSON.stringify(simpleEvents)).toContain('amountReserved');
  });

  it('reports reservation declined via guarantorUpdate when reserve fails', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Reserve PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reserve Funds Requested',
              requestId: 'reserve-fail-1',
              amount: 3300,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);
    deps.bankingFacade.reserveFunds = vi
      .fn()
      .mockRejectedValue(new Error('Insufficient funds'));

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Reservation Declined');
    const simpleEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(JSON.stringify(simpleEvents)).toContain('reserve-fail-1');
    expect(JSON.stringify(simpleEvents)).toContain('Insufficient funds');
  });

  it('reports capture failed via guarantorUpdate when capture throws', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Capture PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Capture Funds Requested',
              requestId: 'capture-fail-1',
              amount: 2100,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);
    deps.bankingFacade.captureHold = vi
      .fn()
      .mockRejectedValue(new Error('Capture blocked'));

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        operation: 'guarantorUpdate',
      })
    );

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;

    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Capture Failed');
    const simpleEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(JSON.stringify(simpleEvents)).toContain('capture-fail-1');
    expect(JSON.stringify(simpleEvents)).toContain('Capture blocked');
  });

  it('intentionally ignores document bootstrap requests emitted by paynote', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: { type: 'PayNote/PayNote', name: 'PayNote with bootstrap' },
          emitted: [
            toOfficialBlue({
              type: 'Conversation/Document Bootstrap Requested',
              document: { type: 'PayNote/PayNote', name: 'Nested PayNote' },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(deps.bankingFacade.transferFunds).not.toHaveBeenCalled();
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message:
          'PayNote emitted event intentionally ignored (Document Bootstrap Requested handled by delivery pipeline)',
      })
    );
  });

  it('intentionally ignores unsupported emitted events', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            name: 'PayNote with unsupported event',
          },
          emitted: [
            {
              type: 'PayNote/Future Event Requested',
            },
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(deps.bankingFacade.transferFunds).not.toHaveBeenCalled();
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message:
          'PayNote emitted event intentionally ignored (unsupported type)',
      })
    );
  });

  it('deduplicates repeated capture immediately requests across webhook events', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const processedEventIds = new Set<string>();
    deps.payNoteRepository.markEventProcessed = vi
      .fn()
      .mockImplementation(async (eventId: string) => {
        if (processedEventIds.has(eventId)) {
          return false;
        }
        processedEventIds.add(eventId);
        return true;
      });

    const repeatedPayload = {
      kind: 'success' as const,
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Quick PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reserve Funds and Capture Immediately Requested',
              requestId: 'capture-now-repeat-1',
              amount: 2500,
            }),
          ],
        },
      },
    } satisfies MyOsFetchEventResult;

    fetchEvent.mockResolvedValueOnce(repeatedPayload);
    fetchDocument.mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);

    const first = await handleWebhookEvent({ eventId: 'event-1' }, deps);
    expect(first.note).toBe('');

    fetchEvent.mockResolvedValueOnce(repeatedPayload);
    const second = await handleWebhookEvent({ eventId: 'event-2' }, deps);
    expect(second.note).toBe('');

    expect(deps.bankingFacade.transferFunds).toHaveBeenCalledTimes(1);
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledTimes(1);
    expect(second.logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'Skipped duplicate PayNote transfer request',
      })
    );
  });

  it('ignores card transaction capture lock request when details mismatch', async () => {
    const { deps, fetchEvent } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: { type: 'PayNote/PayNote', name: 'Slow Digestion PayNote' },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Card Transaction Capture Lock Requested',
              cardTransactionDetails: {
                authorizationCode: 'AUTH99',
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    (deps.holdRepository.getHold as any).mockResolvedValue({
      holdId: 'hold-1',
      payerAccountNumber: '955',
      amountMinor: 12000,
      currency: 'USD',
      status: 'PENDING',
      cardTransactionDetails: {
        retrievalReferenceNumber: '111111111111',
        systemTraceAuditNumber: '222222',
        transmissionDateTime: '0101000000',
        authorizationCode: 'AUTH01',
      },
      captureDisabled: false,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.holdRepository.disableHoldCapture).not.toHaveBeenCalled();
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
  });

  it('creates pending monitoring action from monitoring request event without immediate guarantor response', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Voucher Contract',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Start Card Transaction Monitoring Requested',
              requestId: 'monitoring-request-1',
              targetMerchantId: 'merchant-123',
              events: ['transaction'],
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);

    deps.contractRepository.getContractBySessionId = vi.fn().mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      userId: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            type: 'monitoringConsentApproval',
            status: 'pending',
            targetMerchantId: 'merchant-123',
          }),
        ]),
        monitoringSubscriptions: expect.arrayContaining([
          expect.objectContaining({
            targetMerchantId: 'merchant-123',
            status: 'pending',
          }),
        ]),
      })
    );
    expect(
      deps.contractRepository.addContractHistoryEntry
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        kind: 'pendingActionRequested',
      })
    );
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
  });

  it('stores monitoring pending action without undefined requestId when requestId is absent', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Voucher Contract',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Start Card Transaction Monitoring Requested',
              targetMerchantId: 'merchant-123',
              events: ['transaction'],
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
          payeeAccountNumber: { value: '9876543210' },
        },
      },
    } as MyOsFetchDocumentResult);

    deps.contractRepository.getContractBySessionId = vi.fn().mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      userId: 'user-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    const saved = (
      deps.contractRepository.saveContract as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0] as {
      pendingActions?: Array<Record<string, unknown>>;
      monitoringSubscriptions?: Array<Record<string, unknown>>;
    };
    expect(saved).toBeDefined();
    expect(saved.pendingActions?.[0]).not.toHaveProperty('requestId');
    expect(saved.monitoringSubscriptions?.[0]).not.toHaveProperty('requestId');
  });
});
