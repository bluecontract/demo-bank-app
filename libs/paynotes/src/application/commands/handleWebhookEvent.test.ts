import { describe, it, expect, vi } from 'vitest';
import { handleWebhookEvent } from './handleWebhookEvent';
import type { HandleWebhookEventDependencies } from './handleWebhookEvent';
import type { MyOsFetchEventResult, MyOsFetchDocumentResult } from '../ports';
import { blue } from '../../blue';

const toSimpleRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

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

const runOperationPayloadContainsEventType = (
  payload: unknown,
  eventType: string
): boolean => {
  try {
    const events = parseGuarantorUpdatePayloadEvents(payload);
    const expectedBlueId = resolveTypeBlueId(eventType);
    return events.some(event => {
      const type = event.type as { blueId?: unknown } | undefined;
      return type?.blueId === expectedBlueId;
    });
  } catch {
    return false;
  }
};

const expectRunOperationIncludesEventType = (
  runOperationCalls: Array<Array<{ payload?: unknown }>>,
  eventType: string
) => {
  const hasEvent = runOperationCalls.some(call =>
    runOperationPayloadContainsEventType(call[0]?.payload, eventType)
  );
  expect(hasEvent).toBe(true);
};

const findRunOperationEventByType = (
  runOperationCalls: Array<Array<{ payload?: unknown }>>,
  eventType: string
): Record<string, unknown> | undefined => {
  const expectedBlueId = resolveTypeBlueId(eventType);
  for (const call of runOperationCalls) {
    try {
      const events = parseGuarantorUpdatePayloadEvents(call[0]?.payload);
      const match = events.find(event => {
        const type = event.type as { blueId?: unknown } | undefined;
        return type?.blueId === expectedBlueId;
      });
      if (match) {
        return match;
      }
    } catch {
      continue;
    }
  }

  return undefined;
};

const listRunOperationEventsByType = (
  runOperationCalls: Array<Array<{ payload?: unknown }>>,
  eventType: string
): Array<Record<string, unknown>> => {
  const expectedBlueId = resolveTypeBlueId(eventType);
  const matches: Array<Record<string, unknown>> = [];

  for (const call of runOperationCalls) {
    try {
      const events = parseGuarantorUpdatePayloadEvents(call[0]?.payload);
      events.forEach(event => {
        const type = event.type as { blueId?: unknown } | undefined;
        if (type?.blueId === expectedBlueId) {
          matches.push(event);
        }
      });
    } catch {
      continue;
    }
  }

  return matches;
};

const toOfficialBlue = <T>(value: T): T =>
  blue.nodeToJson(blue.jsonValueToNode(value), {
    format: 'official',
  }) as T;

const buildPaymentMandateDocument = (input?: {
  granteeId?: string;
  amountLimit?: number;
  allowLinkedPayNote?: boolean;
  expiresAt?: string;
  revokedAt?: string;
}) => ({
  type: 'PayNote/Payment Mandate',
  granteeType: 'documentId',
  granteeId: input?.granteeId ?? 'doc-1',
  amountLimit: input?.amountLimit ?? 100_000,
  allowLinkedPayNote: input?.allowLinkedPayNote ?? true,
  ...(input?.expiresAt ? { expiresAt: input.expiresAt } : {}),
  ...(input?.revokedAt ? { revokedAt: input.revokedAt } : {}),
});

const attachPaymentMandate = (input: {
  deps: HandleWebhookEventDependencies;
  fetchDocument: ReturnType<typeof vi.fn>;
  mandateDocumentId?: string;
  mandateSessionId?: string;
  payNoteDocumentId?: string;
  mandateDocument?: Record<string, unknown>;
  autoApproveAuthorization?: boolean;
}) => {
  const mandateDocumentId = input.mandateDocumentId ?? 'mandate-doc-1';
  const mandateSessionId = input.mandateSessionId ?? 'mandate-session-1';
  const payNoteDocumentId = input.payNoteDocumentId ?? 'doc-1';
  const autoApproveAuthorization = input.autoApproveAuthorization ?? true;
  const previousFetchDocumentImpl = input.fetchDocument.getMockImplementation();
  const runDocumentOperation = input.deps.myOsClient.runDocumentOperation as
    | ReturnType<typeof vi.fn>
    | undefined;
  const previousRunDocumentOperationImpl =
    runDocumentOperation?.getMockImplementation();
  const chargeAttemptsById = new Map<
    string,
    {
      authorizationStatus?: 'approved' | 'rejected';
      authorizationReason?: string;
      settled?: boolean;
      lastSettlementProcessingStatus?: 'accepted' | 'rejected';
      settlementReason?: string;
    }
  >();

  input.deps.contractRepository.getContractByDocumentId = vi
    .fn()
    .mockImplementation(async documentId => {
      if (documentId === mandateDocumentId) {
        return {
          contractId: 'mandate-contract-1',
          typeBlueId: 'paynote-payment-mandate-type',
          displayName: 'Payment Mandate',
          sessionId: mandateSessionId,
          documentId: mandateDocumentId,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        };
      }
      return null;
    });

  runDocumentOperation?.mockImplementation(async args => {
    if (
      args.sessionId === mandateSessionId &&
      args.operation === 'authorizeSpend'
    ) {
      const payloadRecord = toSimpleRecord(args.payload);
      const chargeAttemptId = getString(payloadRecord?.chargeAttemptId);
      if (chargeAttemptId && autoApproveAuthorization) {
        chargeAttemptsById.set(chargeAttemptId, {
          authorizationStatus: 'approved',
        });
      }
      return {
        ok: true,
        status: 200,
      };
    }

    if (
      args.sessionId === mandateSessionId &&
      args.operation === 'settleSpend'
    ) {
      const payloadRecord = toSimpleRecord(args.payload);
      const chargeAttemptId = getString(payloadRecord?.chargeAttemptId);
      if (chargeAttemptId) {
        const existing = chargeAttemptsById.get(chargeAttemptId) ?? {};
        chargeAttemptsById.set(chargeAttemptId, {
          ...existing,
          settled: true,
          lastSettlementProcessingStatus: 'accepted',
        });
      }
      return {
        ok: true,
        status: 200,
      };
    }

    if (previousRunDocumentOperationImpl) {
      const result = await previousRunDocumentOperationImpl(args);
      return result as Awaited<
        ReturnType<
          HandleWebhookEventDependencies['myOsClient']['runDocumentOperation']
        >
      >;
    }

    return {
      ok: true,
      status: 200,
    };
  });

  input.fetchDocument.mockImplementation(async sessionId => {
    if (sessionId === mandateSessionId) {
      const baseDocument = toSimpleRecord(input.mandateDocument) ?? {};
      const mergedChargeAttempts = {
        ...(toSimpleRecord(baseDocument.chargeAttempts) ?? {}),
        ...Object.fromEntries(chargeAttemptsById.entries()),
      };
      return {
        kind: 'success',
        document: {
          documentId: mandateDocumentId,
          sessionId: mandateSessionId,
          document: {
            ...(Object.keys(baseDocument).length > 0
              ? baseDocument
              : buildPaymentMandateDocument({ granteeId: payNoteDocumentId })),
            ...(Object.keys(mergedChargeAttempts).length > 0
              ? { chargeAttempts: mergedChargeAttempts }
              : {}),
          },
        },
      } as MyOsFetchDocumentResult;
    }

    if (previousFetchDocumentImpl) {
      const result = await previousFetchDocumentImpl(sessionId);
      return result as MyOsFetchDocumentResult;
    }

    return {
      kind: 'success',
      document: {
        documentId: payNoteDocumentId,
        sessionId: 'session-1',
        document: {
          type: 'PayNote/Card Transaction PayNote',
        },
      },
    } as MyOsFetchDocumentResult;
  });

  return { mandateDocumentId, mandateSessionId };
};

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
    bootstrapDocument: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { sessionId: 'bootstrap-session-1' },
    }),
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
    getActiveCreditLineAccountByUserId: vi.fn().mockResolvedValue({
      id: 'merchant-credit-line-id',
      accountNumber: '4444444444',
      ownerUserId: 'merchant-123',
    }),
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

  it('ignores paynote events from non-canonical session before dispatching handlers', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-shadow',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Card Transaction Capture Lock Requested',
              requestId: 'capture-lock-shadow',
              cardTransactionDetails: {
                authorizationCode: 'AUTH01',
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-shadow',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
        },
      },
    } as MyOsFetchDocumentResult);
    deps.contractRepository.getContractByDocumentId = vi
      .fn()
      .mockResolvedValue({
        contractId: 'contract-1',
        typeBlueId: 'type-1',
        displayName: 'PayNote',
        sessionId: 'session-canonical',
        documentId: 'doc-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

    const result = await handleWebhookEvent({ eventId: 'event-shadow' }, deps);

    expect(result.note).toBe('');
    expect(deps.payNoteRepository.savePayNote).not.toHaveBeenCalled();
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(
      result.logs.some(
        entry =>
          entry.message ===
          'PayNote webhook event ignored (non-canonical session)'
      )
    ).toBe(true);
  });

  it('adds transaction relationship after capture hold succeeds', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
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
      holdId: 'hold-1',
      relatedTransactionId: 'txn-1',
    } as any);

    await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(deps.bankingFacade.captureHold).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'hold-1',
        amountMinor: 1200,
        idempotencyKey: 'paynote-transfer:capture-funds:event-1:0',
      })
    );

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

  it('processes transfer reserve request without payment mandate gating', async () => {
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
            name: 'Reserve-only PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reserve Funds Requested',
              requestId: 'reserve-no-mandate-1',
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

    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'doc-1',
        payerAccountNumber: '1234567890',
        counterpartyAccountNumber: '9876543210',
        amountMinor: 2500,
        idempotencyKey: 'paynote-transfer:reserve-funds:event-1:0',
        payNoteDocumentId: 'doc-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<
            Array<{
              operation?: string;
              payload?: unknown;
            }>
          >;
        };
      }
    ).mock.calls;

    expect(
      runOperationCalls.some(
        call =>
          call[0]?.operation === 'authorizeSpend' ||
          call[0]?.operation === 'settleSpend'
      )
    ).toBe(false);

    expect(
      runOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Card Charge Responded'
        )
      )
    ).toBe(false);

    const payload = runOperationCalls.at(-1)?.[0]?.payload;
    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Funds Reserved');
    const simpleEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(JSON.stringify(simpleEvents)).toContain('reserve-no-mandate-1');
    expect(JSON.stringify(simpleEvents)).toContain('amountReserved');
  });

  it('processes transfer capture request without payment mandate gating', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
      accountNumber: '1234567890',
      transactionId: 'txn-1',
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
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Capture-only PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Capture Funds Requested',
              requestId: 'capture-no-mandate-1',
              amount: 1400,
              paymentMandateDocumentId: 'mandate-ignored-in-transfer-flow',
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

    expect(deps.bankingFacade.captureHold).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'hold-1',
        amountMinor: 1400,
        userId: 'user-123',
        payNoteDocumentId: 'doc-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<
            Array<{
              operation?: string;
              payload?: unknown;
            }>
          >;
        };
      }
    ).mock.calls;

    expect(
      runOperationCalls.some(
        call =>
          call[0]?.operation === 'authorizeSpend' ||
          call[0]?.operation === 'settleSpend'
      )
    ).toBe(false);

    expect(
      runOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Card Charge Responded'
        )
      )
    ).toBe(false);

    const payload = runOperationCalls.at(-1)?.[0]?.payload;
    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Funds Captured');
    const simpleEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(JSON.stringify(simpleEvents)).toContain('capture-no-mandate-1');
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
    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
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

  it('processes repeated capture immediately requests when webhook event ids differ', async () => {
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

    expect(deps.bankingFacade.transferFunds).toHaveBeenCalledTimes(2);
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledTimes(2);
  });

  it('deduplicates transfer request processing by webhook event id and emitted index', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const processedTransferMarkers = new Set<string>();
    deps.payNoteRepository.markEventProcessed = vi
      .fn()
      .mockImplementation(async (marker: string) => {
        if (!marker.startsWith('paynote-transfer-request:')) {
          return true;
        }
        if (processedTransferMarkers.has(marker)) {
          return false;
        }
        processedTransferMarkers.add(marker);
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

    fetchEvent.mockResolvedValueOnce(repeatedPayload);
    const first = await handleWebhookEvent({ eventId: 'event-1' }, deps);
    expect(first.note).toBe('');

    fetchEvent.mockResolvedValueOnce(repeatedPayload);
    const second = await handleWebhookEvent({ eventId: 'event-1' }, deps);
    expect(second.note).toBe('');

    expect(deps.bankingFacade.transferFunds).toHaveBeenCalledTimes(1);
    expect(second.logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'Skipped duplicate PayNote transfer request',
        context: expect.objectContaining({
          eventId: 'event-1',
          eventIndex: 0,
        }),
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

  it('handles linked card charge request with explicit response events', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async sessionId =>
        sessionId === 'session-1'
          ? {
              payNoteDocumentId: 'doc-1',
              deliveryId: 'delivery-1',
              accountNumber: '1234567890',
              userId: 'user-123',
              merchantId: 'merchant-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'paynote-card-charge:doc-1:event-1:0',
        payerAccountNumber: '1234567890',
        counterpartyAccountNumber: '4444444444',
        amountMinor: 2500,
        idempotencyKey: 'paynote-card-charge:reserve:event-1:0',
        payNoteDocumentId: 'doc-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<
            Array<{
              operation?: string;
              sessionId?: string;
              payload?: unknown;
            }>
          >;
        };
      }
    ).mock.calls;
    const authorizeMandateCall = runOperationCalls.find(
      call => call[0]?.operation === 'authorizeSpend'
    );
    expect(authorizeMandateCall?.[0]).toEqual(
      expect.objectContaining({
        sessionId: 'mandate-session-1',
      })
    );
    const authorizePayloadSimple = blue.nodeToJson(
      blue.jsonValueToNode(authorizeMandateCall?.[0]?.payload),
      'simple'
    ) as Record<string, unknown>;
    expect(authorizePayloadSimple).toEqual(
      expect.objectContaining({
        type: expect.objectContaining({
          blueId: resolveTypeBlueId(
            'PayNote/Payment Mandate Spend Authorization Requested'
          ),
        }),
        chargeAttemptId: 'paynote-card-charge-attempt:doc-1:event-1:0',
      })
    );
    const settleMandateCall = runOperationCalls.find(
      call => call[0]?.operation === 'settleSpend'
    );
    expect(settleMandateCall?.[0]).toEqual(
      expect.objectContaining({
        sessionId: 'mandate-session-1',
      })
    );
    const settlePayloadSimple = blue.nodeToJson(
      blue.jsonValueToNode(settleMandateCall?.[0]?.payload),
      'simple'
    ) as Record<string, unknown>;
    expect(settlePayloadSimple).toEqual(
      expect.objectContaining({
        type: expect.objectContaining({
          blueId: resolveTypeBlueId('PayNote/Payment Mandate Spend Settled'),
        }),
        chargeAttemptId: 'paynote-card-charge-attempt:doc-1:event-1:0',
        status: 'succeeded',
      })
    );
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Completed'
    );
  });

  it('rejects card charge when payment mandate id is missing', async () => {
    const { deps, fetchEvent } = createDependencies();

    deps.contractRepository.getContractBySessionId = vi.fn().mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async sessionId =>
        sessionId === 'session-1'
          ? {
              payNoteDocumentId: 'doc-1',
              deliveryId: 'delivery-1',
              accountNumber: '1234567890',
              userId: 'user-123',
              merchantId: 'merchant-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-missing-mandate',
              amount: 2500,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    const respondedEvent = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(respondedEvent).toBeDefined();
    expect(respondedEvent?.status).toBe('rejected');
    expect(respondedEvent?.reason).toBe('Missing payment mandate document id.');
    expect(
      runOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Card Charge Completed'
        )
      )
    ).toBe(false);
    const saveContractCalls = (
      deps.contractRepository.saveContract as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls;
    expect(
      saveContractCalls.some(call => {
        const saved = call[0] as {
          pendingActions?: Array<{ type?: string }>;
        };
        return (
          Array.isArray(saved.pendingActions) &&
          saved.pendingActions.some(
            action => action.type === 'chargeMandateApproval'
          )
        );
      })
    ).toBe(false);
  });

  it('rejects card charge when payment mandate is revoked', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      mandateDocument: buildPaymentMandateDocument({
        granteeId: 'doc-1',
        revokedAt: '2024-01-01T00:00:00.000Z',
      }),
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'session-1'
          ? {
              payNoteDocumentId: 'doc-1',
              deliveryId: 'delivery-1',
              accountNumber: '1234567890',
              userId: 'user-123',
              merchantId: 'merchant-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    deps.contractRepository.getContractBySessionId = vi.fn().mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-expired-mandate',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    const respondedEvent = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(respondedEvent).toBeDefined();
    expect(respondedEvent?.status).toBe('rejected');
    expect(respondedEvent?.reason).toBe('Payment mandate is revoked.');
    expect(
      runOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Card Charge Completed'
        )
      )
    ).toBe(false);
    const saveContractCalls = (
      deps.contractRepository.saveContract as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls;
    expect(
      saveContractCalls.some(call => {
        const saved = call[0] as {
          pendingActions?: Array<{ type?: string }>;
        };
        return (
          Array.isArray(saved.pendingActions) &&
          saved.pendingActions.some(
            action => action.type === 'chargeMandateApproval'
          )
        );
      })
    ).toBe(false);
  });

  it.each([
    {
      eventType: 'PayNote/Linked Card Charge Requested',
      requestId: 'charge-missing-mandate-linked-1',
    },
    {
      eventType: 'PayNote/Linked Card Charge and Capture Immediately Requested',
      requestId: 'charge-missing-mandate-linked-capture-1',
    },
    {
      eventType: 'PayNote/Reverse Card Charge Requested',
      requestId: 'charge-missing-mandate-reverse-1',
    },
    {
      eventType:
        'PayNote/Reverse Card Charge and Capture Immediately Requested',
      requestId: 'charge-missing-mandate-reverse-capture-1',
    },
  ])(
    'rejects $eventType when mandate id is missing',
    async ({ eventType, requestId }) => {
      const { deps, fetchEvent } = createDependencies();

      deps.contractRepository.getContractBySessionId = vi
        .fn()
        .mockResolvedValue({
          contractId: 'contract-1',
          typeBlueId: 'paynote-type',
          displayName: 'PayNote',
          sessionId: 'session-1',
          documentId: 'doc-1',
          userId: 'user-123',
          merchantId: 'merchant-123',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        });

      deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
        payNoteDocumentId: 'doc-1',
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-123',
        merchantId: 'merchant-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-123',
        merchantId: 'merchant-123',
        cardTransactionDetails: {
          retrievalReferenceNumber: '123456789012',
          systemTraceAuditNumber: '654321',
          transmissionDateTime: '0101123456',
          authorizationCode: 'ABC123',
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      fetchEvent.mockResolvedValueOnce({
        kind: 'success',
        payload: {
          object: {
            sessionId: 'session-1',
            document: {
              type: 'PayNote/Card Transaction PayNote',
            },
            emitted: [
              toOfficialBlue({
                type: eventType,
                requestId,
                amount: 2500,
              }),
            ],
          },
        },
      } as MyOsFetchEventResult);

      const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

      expect(result.note).toBe('');
      expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

      const runOperationCalls = (
        deps.myOsClient.runDocumentOperation as unknown as {
          mock: { calls: Array<Array<{ payload?: unknown }>> };
        }
      ).mock.calls;
      const respondedEvent = findRunOperationEventByType(
        runOperationCalls,
        'PayNote/Card Charge Responded'
      );
      expect(respondedEvent).toBeDefined();
      expect(respondedEvent?.status).toBe('rejected');
      expect(respondedEvent?.reason).toBe(
        'Missing payment mandate document id.'
      );
      const saveContractCalls = (
        deps.contractRepository.saveContract as unknown as {
          mock: { calls: Array<Array<Record<string, unknown>>> };
        }
      ).mock.calls;
      expect(
        saveContractCalls.some(call => {
          const saved = call[0] as {
            pendingActions?: Array<{ type?: string }>;
          };
          return (
            Array.isArray(saved.pendingActions) &&
            saved.pendingActions.some(
              action => action.type === 'chargeMandateApproval'
            )
          );
        })
      ).toBe(false);
    }
  );

  it('uses accepted local mandate session when mandate contract projection lags', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      mandateDocumentId: 'mandate-doc-lag-1',
      mandateSessionId: 'mandate-session-lag-1',
      mandateDocument: buildPaymentMandateDocument({
        granteeId: 'doc-1',
        allowLinkedPayNote: false,
      }),
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'session-1'
          ? {
              payNoteDocumentId: 'doc-1',
              deliveryId: 'delivery-1',
              accountNumber: '1234567890',
              userId: 'user-123',
              merchantId: 'merchant-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    deps.contractRepository.getContractBySessionId = vi.fn().mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      userId: 'user-123',
      merchantId: 'merchant-123',
      pendingActions: [
        {
          actionId: 'card-charge-mandate:event-1:0',
          type: 'chargeMandateApproval',
          status: 'accepted',
          requestId: 'charge-lag-1',
          payload: {
            paymentMandateDocumentId: 'mandate-doc-lag-1',
            paymentMandateSessionId: 'mandate-session-lag-1',
          },
          createdAt: '2024-01-01T00:00:00.000Z',
          decidedAt: '2024-01-01T00:01:00.000Z',
        },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:01:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-lag-1',
              amount: 2500,
              paymentMandateDocumentId: 'mandate-doc-lag-1',
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'paynote-card-charge:doc-1:event-1:0',
        payerAccountNumber: '1234567890',
        counterpartyAccountNumber: '4444444444',
        amountMinor: 2500,
      })
    );
    expect(
      (
        deps.contractRepository.getContractByDocumentId as unknown as {
          mock: { calls: Array<Array<unknown>> };
        }
      ).mock.calls.some(call => call[0] === 'mandate-doc-lag-1')
    ).toBe(false);
  });

  it('rejects charge when mandate document cannot be loaded even with accepted local action', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'session-1'
          ? {
              payNoteDocumentId: 'doc-1',
              deliveryId: 'delivery-1',
              accountNumber: '1234567890',
              userId: 'user-123',
              merchantId: 'merchant-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    deps.contractRepository.getContractBySessionId = vi.fn().mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      userId: 'user-123',
      merchantId: 'merchant-123',
      pendingActions: [
        {
          actionId: 'card-charge-mandate:event-1:0',
          type: 'chargeMandateApproval',
          status: 'accepted',
          requestId: 'charge-lag-1',
          payload: {
            paymentMandateDocumentId: 'mandate-doc-lag-1',
            paymentMandateSessionId: 'mandate-session-lag-1',
          },
          createdAt: '2024-01-01T00:00:00.000Z',
          decidedAt: '2024-01-01T00:01:00.000Z',
        },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:01:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    fetchDocument.mockImplementation(async sessionId => {
      if (sessionId === 'mandate-session-lag-1') {
        return {
          kind: 'not-found',
          status: 404,
        } as MyOsFetchDocumentResult;
      }

      return {
        kind: 'success',
        document: {
          documentId: 'doc-1',
          sessionId: 'session-1',
          document: { type: 'PayNote/Card Transaction PayNote' },
        },
      } as MyOsFetchDocumentResult;
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-lag-1',
              amount: 2500,
              paymentMandateDocumentId: 'mandate-doc-lag-1',
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();
    const saveContractCalls = (
      deps.contractRepository.saveContract as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls;
    expect(
      saveContractCalls.some(call => {
        const saved = call[0] as {
          pendingActions?: Array<{ status?: string }>;
        };
        return (
          Array.isArray(saved.pendingActions) &&
          saved.pendingActions.some(action => action.status === 'pending')
        );
      })
    ).toBe(false);

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    const respondedEvent = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(respondedEvent).toBeDefined();
    expect(respondedEvent?.status).toBe('rejected');
    expect(respondedEvent?.reason).toBe(
      'Unable to load payment mandate document.'
    );
  });

  it('returns pending when mandate authorization is not yet confirmed', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      autoApproveAuthorization: false,
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'session-1'
          ? {
              payNoteDocumentId: 'doc-1',
              deliveryId: 'delivery-1',
              accountNumber: '1234567890',
              userId: 'user-123',
              merchantId: 'merchant-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-timeout-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<Array<{ payload?: unknown; operation?: string }>>;
        };
      }
    ).mock.calls;
    const authorizeCall = runOperationCalls.find(
      call => call[0]?.operation === 'authorizeSpend'
    );
    expect(authorizeCall).toBeDefined();

    const respondedEvent = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(respondedEvent).toBeDefined();
    expect(respondedEvent?.status).toBe('pending');
    expect(respondedEvent?.reason).toBe(
      'Awaiting payment mandate authorization.'
    );
  });

  it('ignores duplicate mandate response when charge attempt was already finalized immediately', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId, mandateSessionId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      autoApproveAuthorization: true,
    });
    const processedEvents = new Set<string>();
    deps.payNoteRepository.markEventProcessed = vi
      .fn()
      .mockImplementation(async (eventId: string) => {
        if (processedEvents.has(eventId)) {
          return false;
        }
        processedEvents.add(eventId);
        return true;
      });

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'session-1'
          ? {
              payNoteDocumentId: 'doc-1',
              deliveryId: 'delivery-1',
              accountNumber: '1234567890',
              userId: 'user-123',
              merchantId: 'merchant-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const originatingPayload = {
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-immediate-approved-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult;

    fetchEvent.mockResolvedValueOnce(originatingPayload);
    const first = await handleWebhookEvent({ eventId: 'event-1' }, deps);
    expect(first.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledTimes(1);

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: mandateSessionId,
          document: {
            ...buildPaymentMandateDocument({
              granteeId: 'doc-1',
            }),
            amount: { total: 1 },
            currency: 'USD',
            contracts: {
              granterChannel: { type: 'MyOS/MyOS Timeline Channel' },
              granteeChannel: { type: 'MyOS/MyOS Timeline Channel' },
              guarantorChannel: { type: 'MyOS/MyOS Timeline Channel' },
            },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Payment Mandate Spend Authorization Responded',
              chargeAttemptId: 'paynote-card-charge-attempt:doc-1:event-1:0',
              status: 'approved',
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchEvent.mockResolvedValueOnce(originatingPayload);

    const second = await handleWebhookEvent({ eventId: 'event-2' }, deps);
    expect(second.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledTimes(1);

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    const completedEvents = listRunOperationEventsByType(
      runOperationCalls,
      'PayNote/Card Charge Completed'
    );
    expect(completedEvents).toHaveLength(1);
  });

  it('finalizes pending charge after mandate authorization response (approved)', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId, mandateSessionId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      autoApproveAuthorization: false,
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'session-1'
          ? {
              payNoteDocumentId: 'doc-1',
              deliveryId: 'delivery-1',
              accountNumber: '1234567890',
              userId: 'user-123',
              merchantId: 'merchant-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const originatingPayload = {
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-pending-approved-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult;

    fetchEvent.mockResolvedValueOnce(originatingPayload);

    const first = await handleWebhookEvent({ eventId: 'event-1' }, deps);
    expect(first.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

    const chargeAttemptId = 'paynote-card-charge-attempt:doc-1:event-1:0';
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: mandateSessionId,
          document: {
            ...buildPaymentMandateDocument({
              granteeId: 'doc-1',
            }),
            amount: { total: 1 },
            currency: 'USD',
            contracts: {
              granterChannel: { type: 'MyOS/MyOS Timeline Channel' },
              granteeChannel: { type: 'MyOS/MyOS Timeline Channel' },
              guarantorChannel: { type: 'MyOS/MyOS Timeline Channel' },
            },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Payment Mandate Spend Authorization Responded',
              chargeAttemptId,
              status: 'approved',
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchEvent.mockResolvedValueOnce(originatingPayload);

    const second = await handleWebhookEvent({ eventId: 'event-2' }, deps);
    expect(second.note).toBe('');

    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'paynote-card-charge:doc-1:event-1:0',
        amountMinor: 2500,
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;

    const respondedEvents = listRunOperationEventsByType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(respondedEvents.map(event => event.status)).toEqual(
      expect.arrayContaining(['pending', 'accepted'])
    );
    const completedEvent = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Card Charge Completed'
    );
    expect(completedEvent?.status).toBe('succeeded');
  });

  it('emits rejected response when mandate authorization response is rejected', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId, mandateSessionId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      autoApproveAuthorization: false,
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'session-1'
          ? {
              payNoteDocumentId: 'doc-1',
              deliveryId: 'delivery-1',
              accountNumber: '1234567890',
              userId: 'user-123',
              merchantId: 'merchant-123',
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const originatingPayload = {
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-pending-rejected-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult;

    fetchEvent.mockResolvedValueOnce(originatingPayload);
    const first = await handleWebhookEvent({ eventId: 'event-1' }, deps);
    expect(first.note).toBe('');

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: mandateSessionId,
          document: {
            ...buildPaymentMandateDocument({
              granteeId: 'doc-1',
            }),
            amount: { total: 1 },
            currency: 'USD',
            contracts: {
              granterChannel: { type: 'MyOS/MyOS Timeline Channel' },
              granteeChannel: { type: 'MyOS/MyOS Timeline Channel' },
              guarantorChannel: { type: 'MyOS/MyOS Timeline Channel' },
            },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Payment Mandate Spend Authorization Responded',
              chargeAttemptId: 'paynote-card-charge-attempt:doc-1:event-1:0',
              status: 'rejected',
              reason: 'Denied by mandate policy.',
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchEvent.mockResolvedValueOnce(originatingPayload);

    const second = await handleWebhookEvent({ eventId: 'event-2' }, deps);
    expect(second.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;

    const respondedEvents = listRunOperationEventsByType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(respondedEvents.map(event => event.status)).toEqual(
      expect.arrayContaining(['pending', 'rejected'])
    );
    const lastRejected = respondedEvents.find(
      event => event.status === 'rejected'
    );
    expect(lastRejected?.reason).toBe('Denied by mandate policy.');
  });

  it('handles reverse card charge request with swapped payer/payee accounts', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    deps.bankingFacade.getAccountByNumber = vi
      .fn()
      .mockImplementation(async accountNumber => {
        if (accountNumber === '4444444444') {
          return {
            id: 'merchant-credit-line-id',
            accountNumber,
            ownerUserId: 'merchant-owner',
          };
        }
        return {
          id: 'customer-account-id',
          accountNumber,
          ownerUserId: 'customer-owner',
        };
      });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reverse Card Charge Requested',
              requestId: 'reverse-charge-1',
              amount: 2700,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'paynote-card-charge:doc-1:event-1:0',
        payerAccountNumber: '4444444444',
        counterpartyAccountNumber: '1234567890',
        amountMinor: 2700,
        idempotencyKey: 'paynote-card-charge:reserve:event-1:0',
        payNoteDocumentId: 'doc-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Completed'
    );
  });

  it('handles reverse card charge and capture immediately with swapped accounts', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    deps.bankingFacade.getAccountByNumber = vi
      .fn()
      .mockImplementation(async accountNumber => {
        if (accountNumber === '4444444444') {
          return {
            id: 'merchant-credit-line-id',
            accountNumber,
            ownerUserId: 'merchant-owner',
          };
        }
        return {
          id: 'customer-account-id',
          accountNumber,
          ownerUserId: 'customer-owner',
        };
      });
    deps.bankingFacade.captureHold = vi.fn().mockResolvedValue({
      holdId: 'paynote-card-charge:doc-1:event-1:0',
      relatedTransactionId: 'txn-reverse-1',
    } as any);

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reverse Card Charge and Capture Immediately Requested',
              requestId: 'reverse-charge-capture-1',
              amount: 1300,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        payerAccountNumber: '4444444444',
        counterpartyAccountNumber: '1234567890',
        amountMinor: 1300,
      })
    );
    expect(deps.bankingFacade.captureHold).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'paynote-card-charge:doc-1:event-1:0',
        userId: 'merchant-owner',
        counterpartyAccountNumber: '1234567890',
        idempotencyKey: 'paynote-card-charge:capture:event-1:0',
        payNoteDocumentId: 'doc-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Completed'
    );
  });

  it('persists hold context across repeated linked and reverse charge cycles', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    let persistedPayNote: Record<string, unknown> = {
      payNoteDocumentId: 'doc-1',
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async () => persistedPayNote);
    deps.payNoteRepository.savePayNote = vi
      .fn()
      .mockImplementation(async record => {
        persistedPayNote = { ...record };
      });

    let persistedContract: Record<string, unknown> | null = null;
    const getContractByDocumentIdMock = deps.contractRepository
      .getContractByDocumentId as unknown as ReturnType<typeof vi.fn>;
    const baseGetContractByDocumentIdImpl =
      getContractByDocumentIdMock.getMockImplementation();
    deps.contractRepository.getContractByDocumentId = vi
      .fn()
      .mockImplementation(async documentId => {
        if (documentId === 'doc-1') {
          return persistedContract;
        }
        if (baseGetContractByDocumentIdImpl) {
          return baseGetContractByDocumentIdImpl(documentId);
        }
        return null;
      });
    deps.contractRepository.saveContract = vi
      .fn()
      .mockImplementation(async contract => {
        persistedContract = contract;
      });

    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    deps.bankingFacade.getAccountByNumber = vi
      .fn()
      .mockImplementation(async accountNumber => {
        if (accountNumber === '4444444444') {
          return {
            id: 'merchant-credit-line-id',
            accountNumber,
            ownerUserId: 'merchant-owner',
          };
        }
        return {
          id: 'customer-account-id',
          accountNumber,
          ownerUserId: 'customer-owner',
        };
      });

    deps.bankingFacade.reserveFunds = vi
      .fn()
      .mockResolvedValueOnce({ holdId: 'ignored-reserve-hold-1' })
      .mockResolvedValueOnce({ holdId: 'ignored-reserve-hold-2' });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'linked-cycle-1',
              amount: 1100,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reverse Card Charge Requested',
              requestId: 'reverse-cycle-2',
              amount: 700,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const first = await handleWebhookEvent({ eventId: 'event-linked-1' }, deps);
    const second = await handleWebhookEvent(
      { eventId: 'event-reverse-2' },
      deps
    );

    expect(first.note).toBe('');
    expect(second.note).toBe('');

    expect(deps.bankingFacade.reserveFunds).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        holdId: 'paynote-card-charge:doc-1:event-linked-1:0',
        payerAccountNumber: '1234567890',
        counterpartyAccountNumber: '4444444444',
        amountMinor: 1100,
      })
    );
    expect(deps.bankingFacade.reserveFunds).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        holdId: 'paynote-card-charge:doc-1:event-reverse-2:0',
        payerAccountNumber: '4444444444',
        counterpartyAccountNumber: '1234567890',
        amountMinor: 700,
      })
    );

    const savedPayNotes = (
      deps.payNoteRepository.savePayNote as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls.map(call => call[0]);
    expect(
      savedPayNotes.some(
        record => record.holdId === 'paynote-card-charge:doc-1:event-linked-1:0'
      )
    ).toBe(true);
    expect(
      savedPayNotes.some(
        record =>
          record.holdId === 'paynote-card-charge:doc-1:event-reverse-2:0'
      )
    ).toBe(true);

    expect(deps.contractRepository.saveContract).toHaveBeenCalled();
    const lastSavedContract = (
      deps.contractRepository.saveContract as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls.at(-1)?.[0];
    expect(lastSavedContract).toEqual(
      expect.objectContaining({
        relatedHoldIds: expect.arrayContaining([
          'paynote-card-charge:doc-1:event-linked-1:0',
          'paynote-card-charge:doc-1:event-reverse-2:0',
        ]),
      })
    );
    expect(
      (lastSavedContract?.relatedHoldIds as string[] | undefined)?.length
    ).toBe(2);
  });

  it('handles linked card charge request for chained paynote without direct delivery record', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      holdId: 'root-hold-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue(null);

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-chain-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'paynote-card-charge:doc-1:event-1:0',
        payerAccountNumber: '1234567890',
        counterpartyAccountNumber: '4444444444',
        amountMinor: 2500,
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Completed'
    );
  });

  it('rejects linked card charge request without delivery when record has no hold/transaction context', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue(null);

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-no-chain-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(
      runOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Card Charge Completed'
        )
      )
    ).toBe(false);
  });

  it('rejects linked card charge request when contract is not in card txn chain', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-no-root-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
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
          type: 'PayNote/Card Transaction PayNote',
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(
      runOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Card Charge Completed'
        )
      )
    ).toBe(false);
  });

  it.each([
    {
      eventType: 'PayNote/Linked Card Charge Requested',
      requestId: 'charge-chain-matrix-linked-1',
    },
    {
      eventType: 'PayNote/Linked Card Charge and Capture Immediately Requested',
      requestId: 'charge-chain-matrix-linked-capture-1',
    },
    {
      eventType: 'PayNote/Reverse Card Charge Requested',
      requestId: 'charge-chain-matrix-reverse-1',
    },
    {
      eventType:
        'PayNote/Reverse Card Charge and Capture Immediately Requested',
      requestId: 'charge-chain-matrix-reverse-capture-1',
    },
  ])(
    'rejects $eventType when PayNote has no card transaction chain context',
    async ({ eventType, requestId }) => {
      const { deps, fetchEvent, fetchDocument } = createDependencies();
      const { mandateDocumentId } = attachPaymentMandate({
        deps,
        fetchDocument,
        payNoteDocumentId: 'doc-1',
      });

      deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
        payNoteDocumentId: 'doc-1',
        accountNumber: '1234567890',
        userId: 'user-123',
        merchantId: 'merchant-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue(
        null
      );

      fetchEvent.mockResolvedValueOnce({
        kind: 'success',
        payload: {
          object: {
            sessionId: 'session-1',
            document: {
              type: 'PayNote/PayNote',
            },
            emitted: [
              toOfficialBlue({
                type: eventType,
                requestId,
                amount: 2500,
                paymentMandateDocumentId: mandateDocumentId,
              }),
            ],
          },
        },
      } as MyOsFetchEventResult);

      const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

      expect(result.note).toBe('');
      expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

      const runOperationCalls = (
        deps.myOsClient.runDocumentOperation as unknown as {
          mock: { calls: Array<Array<{ payload?: unknown }>> };
        }
      ).mock.calls;
      const respondedEvent = findRunOperationEventByType(
        runOperationCalls,
        'PayNote/Card Charge Responded'
      );
      expect(respondedEvent).toBeDefined();
      expect(respondedEvent?.status).toBe('rejected');
      expect(respondedEvent?.reason).toBe(
        'Card charge request requires PayNote rooted in a card transaction chain.'
      );
      expect(
        runOperationCalls.some(call =>
          runOperationPayloadContainsEventType(
            call[0]?.payload,
            'PayNote/Card Charge Completed'
          )
        )
      ).toBe(false);
    }
  );

  it('emits linked paynote startup response events after successful charge', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    deps.bankingFacade.captureHold = vi.fn().mockResolvedValue({
      holdId: 'paynote-card-charge:doc-1:event-1:0',
      relatedTransactionId: 'txn-1',
    } as any);
    deps.myOsClient.bootstrapDocument = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { sessionId: 'delivery-session-1' },
    });
    deps.myOsClient.runDocumentOperation = vi
      .fn()
      .mockImplementation(async input => {
        if (input.operation === 'acceptPayNote') {
          return {
            ok: true,
            status: 200,
            body: { payNoteSessionId: 'linked-paynote-session-1' },
          };
        }
        return { ok: true, status: 200 };
      });
    fetchDocument.mockImplementation(async sessionId => {
      if (sessionId === 'linked-paynote-session-1') {
        return {
          kind: 'success',
          document: {
            documentId: 'child-doc-1',
            sessionId: 'linked-paynote-session-1',
            document: { type: 'PayNote/PayNote' },
          },
        } as MyOsFetchDocumentResult;
      }
      return {
        kind: 'success',
        document: {
          documentId: 'doc-1',
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
            contracts: {
              payerChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'customer-account-id',
              },
              payeeChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'merchant-account-id',
              },
              guarantorChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'account-id',
              },
            },
          },
        },
      } as MyOsFetchDocumentResult;
    });
    deps.contractRepository.getContractBySessionId = vi.fn().mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      customerChannelKey: 'payerChannel',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
            contracts: {
              payerChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'customer-account-id',
              },
              payeeChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'merchant-account-id',
              },
              guarantorChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'account-id',
              },
            },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge and Capture Immediately Requested',
              requestId: 'charge-link-1',
              amount: 1300,
              paymentMandateDocumentId: mandateDocumentId,
              paynote: {
                type: 'PayNote/PayNote',
                name: 'Linked voucher',
                currency: 'USD',
                amount: {
                  total: 1,
                },
                contracts: {
                  payerChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  payeeChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  guarantorChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                },
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          document: expect.objectContaining({
            type: 'PayNote/PayNote Delivery',
            payNoteBootstrapRequest: expect.objectContaining({
              type: 'Conversation/Document Bootstrap Requested',
              bootstrapAssignee: 'payNoteDeliverer',
            }),
          }),
          channelBindings: {
            payNoteSender: { accountId: 'merchant-account-id' },
            payNoteDeliverer: { accountId: 'account-id' },
            payerChannel: { accountId: 'customer-account-id' },
            payeeChannel: { accountId: 'merchant-account-id' },
          },
        }),
      })
    );
    expect(deps.myOsClient.runDocumentOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'delivery-session-1',
        operation: 'acceptPayNote',
      })
    );
    expect(deps.bootstrapContextRepository.saveContext).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapSessionId: 'delivery-session-1',
        holdId: 'paynote-card-charge:doc-1:event-1:0',
        transactionId: 'txn-1',
        customerChannelKey: 'payerChannel',
        requestingSessionId: 'session-1',
        requestId: 'charge-link-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Linked PayNote Start Responded'
    );
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Linked PayNote Started'
    );
  });

  it('starts linked paynote for chained paynote using root hold transaction details', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      holdId: 'root-hold-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue(null);
    deps.holdRepository.getHold = vi.fn().mockImplementation(async holdId => {
      if (holdId === 'root-hold-1') {
        return {
          holdId,
          cardTransactionDetails: {
            retrievalReferenceNumber: '123456789012',
            systemTraceAuditNumber: '654321',
            transmissionDateTime: '0101123456',
            authorizationCode: 'ABC123',
          },
        };
      }
      return null;
    });
    deps.myOsClient.bootstrapDocument = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { sessionId: 'delivery-session-chain-1' },
    });
    deps.myOsClient.runDocumentOperation = vi
      .fn()
      .mockImplementation(async input => {
        if (input.operation === 'acceptPayNote') {
          return {
            ok: true,
            status: 200,
            body: { payNoteSessionId: 'linked-paynote-chain-session-1' },
          };
        }
        return { ok: true, status: 200 };
      });
    fetchDocument.mockImplementation(async sessionId => {
      if (sessionId === 'linked-paynote-chain-session-1') {
        return {
          kind: 'success',
          document: {
            documentId: 'child-chain-doc-1',
            sessionId: 'linked-paynote-chain-session-1',
            document: { type: 'PayNote/PayNote' },
          },
        } as MyOsFetchDocumentResult;
      }
      return {
        kind: 'success',
        document: {
          documentId: 'doc-1',
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            contracts: {
              payerChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'customer-account-id',
              },
              payeeChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'merchant-account-id',
              },
              guarantorChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'account-id',
              },
            },
          },
        },
      } as MyOsFetchDocumentResult;
    });
    deps.contractRepository.getContractBySessionId = vi.fn().mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'paynote-type',
      displayName: 'PayNote',
      sessionId: 'session-1',
      documentId: 'doc-1',
      customerChannelKey: 'payerChannel',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            contracts: {
              payerChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'customer-account-id',
              },
              payeeChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'merchant-account-id',
              },
              guarantorChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'account-id',
              },
            },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'charge-chain-linked-1',
              amount: 1300,
              paymentMandateDocumentId: mandateDocumentId,
              paynote: {
                type: 'PayNote/PayNote',
                name: 'Chained linked voucher',
                currency: 'USD',
                amount: {
                  total: 1,
                },
                contracts: {
                  payerChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  payeeChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  guarantorChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                },
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.holdRepository.getHold).toHaveBeenCalledWith('root-hold-1');
    expect(deps.myOsClient.bootstrapDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          document: expect.objectContaining({
            type: 'PayNote/PayNote Delivery',
          }),
        }),
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Linked PayNote Start Responded'
    );
    expectRunOperationIncludesEventType(
      runOperationCalls,
      'PayNote/Linked PayNote Started'
    );
  });

  it('rejects linked paynote startup when linked paynote payload has explicit account mapping', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
    });
    deps.bankingFacade.captureHold = vi.fn().mockResolvedValue({
      holdId: 'paynote-card-charge:doc-1:event-1:0',
      relatedTransactionId: 'txn-1',
    } as any);
    fetchDocument.mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/Card Transaction PayNote',
          contracts: {
            payerChannel: {
              type: 'MyOS/MyOS Timeline Channel',
              accountId: 'customer-account-id',
            },
            payeeChannel: {
              type: 'MyOS/MyOS Timeline Channel',
              accountId: 'merchant-account-id',
            },
            guarantorChannel: {
              type: 'MyOS/MyOS Timeline Channel',
              accountId: 'account-id',
            },
          },
        },
      },
    } as MyOsFetchDocumentResult);

    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
            contracts: {
              payerChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'customer-account-id',
              },
              payeeChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'merchant-account-id',
              },
              guarantorChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'account-id',
              },
            },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge and Capture Immediately Requested',
              requestId: 'charge-link-explicit-account-1',
              amount: 1300,
              paymentMandateDocumentId: mandateDocumentId,
              paynote: {
                type: 'PayNote/PayNote',
                name: 'Linked voucher',
                currency: 'USD',
                amount: {
                  total: 1,
                },
                payerAccountNumber: '1111111111',
                payeeAccountNumber: '2222222222',
                contracts: {
                  payerChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  payeeChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  guarantorChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                },
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.myOsClient.bootstrapDocument).not.toHaveBeenCalled();

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    const respondedEvent = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Linked PayNote Start Responded'
    );
    expect(respondedEvent).toBeDefined();
    expect(respondedEvent?.status).toBe('rejected');
    expect(respondedEvent?.reason).toBe(
      'Linked PayNote startup does not allow explicit payer/payee account mapping.'
    );
    expect(
      runOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Linked PayNote Started'
        )
      )
    ).toBe(false);
  });

  it('starts linked paynote delivery without auto-accept when mandate policy disallows it', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
    });
    deps.bankingFacade.captureHold = vi.fn().mockResolvedValue({
      holdId: 'paynote-card-charge:doc-1:event-1:0',
      relatedTransactionId: 'txn-1',
    } as any);
    deps.myOsClient.bootstrapDocument = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { sessionId: 'delivery-session-no-auto-accept' },
    });
    fetchDocument.mockResolvedValue({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/Card Transaction PayNote',
          contracts: {
            payerChannel: {
              type: 'MyOS/MyOS Timeline Channel',
              accountId: 'customer-account-id',
            },
            payeeChannel: {
              type: 'MyOS/MyOS Timeline Channel',
              accountId: 'merchant-account-id',
            },
            guarantorChannel: {
              type: 'MyOS/MyOS Timeline Channel',
              accountId: 'account-id',
            },
          },
        },
      },
    } as MyOsFetchDocumentResult);

    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      mandateDocument: buildPaymentMandateDocument({
        granteeId: 'doc-1',
        allowLinkedPayNote: false,
      }),
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
            contracts: {
              payerChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'customer-account-id',
              },
              payeeChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'merchant-account-id',
              },
              guarantorChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'account-id',
              },
            },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge and Capture Immediately Requested',
              requestId: 'charge-link-no-auto-accept-1',
              amount: 1300,
              paymentMandateDocumentId: mandateDocumentId,
              paynote: {
                type: 'PayNote/PayNote',
                name: 'Linked voucher',
                currency: 'USD',
                amount: {
                  total: 1,
                },
                contracts: {
                  payerChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  payeeChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  guarantorChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                },
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.myOsClient.bootstrapDocument).toHaveBeenCalled();

    const runDocumentOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<Array<{ operation?: string; payload?: unknown }>>;
        };
      }
    ).mock.calls;
    expect(
      runDocumentOperationCalls.some(
        call => call[0]?.operation === 'acceptPayNote'
      )
    ).toBe(false);

    expectRunOperationIncludesEventType(
      runDocumentOperationCalls,
      'PayNote/Linked PayNote Start Responded'
    );
    expect(
      runDocumentOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Linked PayNote Started'
        )
      )
    ).toBe(false);
  });

  it('rejects linked paynote startup when source document has no channel bindings', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    deps.bankingFacade.captureHold = vi.fn().mockResolvedValue({
      holdId: 'paynote-card-charge:doc-1:event-1:0',
      relatedTransactionId: 'txn-1',
    } as any);

    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge and Capture Immediately Requested',
              requestId: 'charge-link-no-bindings-1',
              amount: 1300,
              paymentMandateDocumentId: mandateDocumentId,
              paynote: {
                type: 'PayNote/PayNote',
                name: 'Linked voucher',
                currency: 'USD',
                amount: {
                  total: 1,
                },
                contracts: {
                  payerChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  payeeChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  guarantorChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                },
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    expect(deps.myOsClient.bootstrapDocument).not.toHaveBeenCalled();

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    const respondedEvent = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Linked PayNote Start Responded'
    );
    expect(respondedEvent).toBeDefined();
    expect(respondedEvent?.status).toBe('rejected');
    expect(respondedEvent?.reason).toBe(
      'Linked PayNote startup requires source contract channels in document payload.'
    );
    expect(
      runOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Linked PayNote Started'
        )
      )
    ).toBe(false);
  });

  it.each([
    {
      name: 'successfully starts linked voucher after reverse charge',
      explicitAccountMapping: false,
      expectedLinkedStatus: 'accepted',
      expectLinkedStarted: true,
    },
    {
      name: 'rejects linked voucher when payload has explicit account mapping',
      explicitAccountMapping: true,
      expectedLinkedStatus: 'rejected',
      expectLinkedStarted: false,
    },
  ])('voucher flow matrix: $name', async scenario => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      cardTransactionDetails: {
        retrievalReferenceNumber: '123456789012',
        systemTraceAuditNumber: '654321',
        transmissionDateTime: '0101123456',
        authorizationCode: 'ABC123',
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    deps.bankingFacade.reserveFunds = vi.fn().mockResolvedValue({
      holdId: 'paynote-card-charge:doc-1:event-1:0',
    } as any);
    deps.myOsClient.bootstrapDocument = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { sessionId: 'voucher-delivery-session-1' },
    });
    deps.myOsClient.runDocumentOperation = vi
      .fn()
      .mockImplementation(async input => {
        if (input.operation === 'acceptPayNote') {
          return {
            ok: true,
            status: 200,
            body: { payNoteSessionId: 'voucher-paynote-session-1' },
          };
        }
        return { ok: true, status: 200 };
      });

    fetchDocument.mockImplementation(async sessionId => {
      if (sessionId === 'voucher-paynote-session-1') {
        return {
          kind: 'success',
          document: {
            documentId: 'voucher-doc-1',
            sessionId: 'voucher-paynote-session-1',
            document: { type: 'PayNote/PayNote' },
          },
        } as MyOsFetchDocumentResult;
      }
      return {
        kind: 'success',
        document: {
          documentId: 'doc-1',
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
            contracts: {
              payerChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'customer-account-id',
              },
              payeeChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'merchant-account-id',
              },
              guarantorChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'account-id',
              },
            },
          },
        },
      } as MyOsFetchDocumentResult;
    });

    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
            contracts: {
              payerChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'customer-account-id',
              },
              payeeChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'merchant-account-id',
              },
              guarantorChannel: {
                type: 'MyOS/MyOS Timeline Channel',
                accountId: 'account-id',
              },
            },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reverse Card Charge Requested',
              requestId: 'voucher-flow-1',
              amount: 1300,
              paymentMandateDocumentId: mandateDocumentId,
              paynote: {
                type: 'PayNote/PayNote',
                name: 'Voucher matrix paynote',
                currency: 'USD',
                amount: {
                  total: 1,
                },
                ...(scenario.explicitAccountMapping
                  ? {
                      payerAccountNumber: '1111111111',
                      payeeAccountNumber: '2222222222',
                    }
                  : {}),
                contracts: {
                  payerChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  payeeChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                  guarantorChannel: {
                    type: 'MyOS/MyOS Timeline Channel',
                  },
                },
              },
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent({ eventId: 'event-1' }, deps);

    expect(result.note).toBe('');
    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;

    const chargeResponded = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(chargeResponded?.status).toBe('accepted');
    const chargeCompleted = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Card Charge Completed'
    );
    expect(chargeCompleted?.status).toBe('succeeded');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledTimes(1);
    expect(deps.bankingFacade.captureHold).not.toHaveBeenCalled();
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'paynote-card-charge:doc-1:event-1:0',
        amountMinor: 1300,
        payNoteDocumentId: 'doc-1',
      })
    );

    const linkedResponded = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Linked PayNote Start Responded'
    );
    expect(linkedResponded?.status).toBe(scenario.expectedLinkedStatus);

    const linkedStartedEvents = listRunOperationEventsByType(
      runOperationCalls,
      'PayNote/Linked PayNote Started'
    );
    expect(linkedStartedEvents.length > 0).toBe(scenario.expectLinkedStarted);
    if (scenario.expectLinkedStarted) {
      expect(linkedStartedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            payNoteDocumentId: 'voucher-doc-1',
          }),
        ])
      );
    }
  });

  it.each([
    {
      name: 'processes repeated linked subscription charges inside card txn chain',
      chainContext: 'delivery',
      expectedCompletedCount: 2,
      expectedRejectedCount: 0,
    },
    {
      name: 'rejects linked subscription charge outside card txn chain',
      chainContext: 'none',
      expectedCompletedCount: 0,
      expectedRejectedCount: 1,
    },
  ])('subscription flow matrix: $name', async scenario => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
    });

    if (scenario.chainContext === 'delivery') {
      deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
        payNoteDocumentId: 'doc-1',
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-123',
        merchantId: 'merchant-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue({
        deliveryId: 'delivery-1',
        accountNumber: '1234567890',
        userId: 'user-123',
        merchantId: 'merchant-123',
        cardTransactionDetails: {
          retrievalReferenceNumber: '123456789012',
          systemTraceAuditNumber: '654321',
          transmissionDateTime: '0101123456',
          authorizationCode: 'ABC123',
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      fetchEvent.mockResolvedValueOnce({
        kind: 'success',
        payload: {
          object: {
            sessionId: 'session-1',
            document: { type: 'PayNote/Card Transaction PayNote' },
            emitted: [
              toOfficialBlue({
                type: 'PayNote/Linked Card Charge Requested',
                requestId: 'subscription-charge-1',
                amount: 500,
                paymentMandateDocumentId: mandateDocumentId,
              }),
            ],
          },
        },
      } as MyOsFetchEventResult);
      fetchEvent.mockResolvedValueOnce({
        kind: 'success',
        payload: {
          object: {
            sessionId: 'session-1',
            document: { type: 'PayNote/Card Transaction PayNote' },
            emitted: [
              toOfficialBlue({
                type: 'PayNote/Linked Card Charge Requested',
                requestId: 'subscription-charge-2',
                amount: 800,
                paymentMandateDocumentId: mandateDocumentId,
              }),
            ],
          },
        },
      } as MyOsFetchEventResult);
    } else {
      deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
        payNoteDocumentId: 'doc-1',
        accountNumber: '1234567890',
        userId: 'user-123',
        merchantId: 'merchant-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue(
        null
      );
      fetchEvent.mockResolvedValueOnce({
        kind: 'success',
        payload: {
          object: {
            sessionId: 'session-1',
            document: { type: 'PayNote/PayNote' },
            emitted: [
              toOfficialBlue({
                type: 'PayNote/Linked Card Charge Requested',
                requestId: 'subscription-charge-no-chain-1',
                amount: 500,
                paymentMandateDocumentId: mandateDocumentId,
              }),
            ],
          },
        },
      } as MyOsFetchEventResult);
    }

    const first = await handleWebhookEvent({ eventId: 'event-1' }, deps);
    if (scenario.chainContext === 'delivery') {
      const second = await handleWebhookEvent({ eventId: 'event-2' }, deps);
      expect(second.note).toBe('');
    }
    expect(first.note).toBe('');

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    const completedEvents = listRunOperationEventsByType(
      runOperationCalls,
      'PayNote/Card Charge Completed'
    );
    const rejectedRespondedEvents = listRunOperationEventsByType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    ).filter(event => event.status === 'rejected');

    expect(deps.bankingFacade.captureHold).not.toHaveBeenCalled();
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledTimes(
      scenario.expectedCompletedCount
    );
    if (scenario.chainContext === 'delivery') {
      expect(deps.bankingFacade.reserveFunds).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          amountMinor: 500,
          holdId: 'paynote-card-charge:doc-1:event-1:0',
        })
      );
      expect(deps.bankingFacade.reserveFunds).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          amountMinor: 800,
          holdId: 'paynote-card-charge:doc-1:event-2:0',
        })
      );
    }
    expect(completedEvents.length).toBe(scenario.expectedCompletedCount);
    expect(rejectedRespondedEvents.length).toBe(scenario.expectedRejectedCount);
  });
});
