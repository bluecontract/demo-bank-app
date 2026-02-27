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
      const serializedChargeAttempts = Object.fromEntries(
        Object.entries(mergedChargeAttempts).map(
          ([chargeAttemptId, attempt]) => [
            chargeAttemptId,
            toSimpleRecord(attempt) ?? {},
          ]
        )
      );
      return {
        kind: 'success',
        document: {
          documentId: mandateDocumentId,
          sessionId: mandateSessionId,
          document: {
            ...(Object.keys(baseDocument).length > 0
              ? baseDocument
              : buildPaymentMandateDocument({ granteeId: payNoteDocumentId })),
            ...(Object.keys(serializedChargeAttempts).length > 0
              ? { chargeAttempts: serializedChargeAttempts }
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
    getActiveCreditLineAccountByMerchantId: vi.fn().mockResolvedValue({
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
      finalizeEventProcessing: vi.fn().mockResolvedValue(undefined),
      releaseEventProcessing: vi.fn().mockResolvedValue(undefined),
    };

  const bootstrapContextRepository: HandleWebhookEventDependencies['bootstrapContextRepository'] =
    {
      getContextBySessionId: vi.fn().mockResolvedValue(null),
      getBootstrapSessionIdByTargetSessionId: vi.fn().mockResolvedValue(null),
      saveContext: vi.fn(),
      saveTargetSessionBootstrapLink: vi.fn(),
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
    expect(deps.payNoteRepository.finalizeEventProcessing).toHaveBeenCalledWith(
      'event-1'
    );
    expect(
      deps.payNoteRepository.releaseEventProcessing
    ).not.toHaveBeenCalled();
  });

  it('resolves bootstrap context via target-session link when direct context is missing', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    deps.bootstrapContextRepository.getContextBySessionId = vi
      .fn()
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'bootstrap-ctx-1'
          ? {
              bootstrapSessionId: 'bootstrap-ctx-1',
              merchantId: 'merchant-ctx-1',
              accountNumber: '9559276001',
              userId: 'user-ctx-1',
              createdAt: '2024-01-01T00:00:00.000Z',
            }
          : null
      );
    deps.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId = vi
      .fn()
      .mockResolvedValue('bootstrap-ctx-1');

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'target-session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            payeeAccountNumber: { value: '9876543210' },
            name: 'Linked Context PayNote',
          },
          emitted: [],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'target-session-1',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent(
      { eventId: 'event-linked-context' },
      deps
    );

    expect(result.note).toBe('');
    expect(
      deps.bootstrapContextRepository.getBootstrapSessionIdByTargetSessionId
    ).toHaveBeenCalledWith('target-session-1');
    expect(deps.payNoteRepository.savePayNote).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: '9559276001',
        userId: 'user-ctx-1',
        merchantId: 'merchant-ctx-1',
      })
    );
  });

  it('releases paynote event processing claim when handling fails', async () => {
    const { deps } = createDependencies();
    deps.payNoteRepository.savePayNote = vi
      .fn()
      .mockRejectedValue(new Error('save failed'));

    await expect(
      handleWebhookEvent({ eventId: 'event-release-on-error' }, deps)
    ).rejects.toThrow('save failed');

    expect(deps.payNoteRepository.releaseEventProcessing).toHaveBeenCalledWith(
      'event-release-on-error'
    );
    expect(
      deps.payNoteRepository.finalizeEventProcessing
    ).not.toHaveBeenCalled();
  });

  it('returns early when paynote webhook idempotency entry is already completed', async () => {
    const { deps } = createDependencies();
    deps.payNoteRepository.markEventProcessed = vi
      .fn()
      .mockResolvedValue(false);
    deps.payNoteRepository.getEventProcessingStatus = vi
      .fn()
      .mockResolvedValue('completed');

    const result = await handleWebhookEvent(
      { eventId: 'event-completed' },
      deps
    );

    expect(result.note).toBe('');
    expect(
      deps.payNoteRepository.finalizeEventProcessing
    ).not.toHaveBeenCalled();
    expect(
      deps.payNoteRepository.releaseEventProcessing
    ).not.toHaveBeenCalled();
  });

  it('throws when paynote webhook idempotency entry is still processing', async () => {
    const { deps } = createDependencies();
    deps.payNoteRepository.markEventProcessed = vi
      .fn()
      .mockResolvedValue(false);
    deps.payNoteRepository.getEventProcessingStatus = vi
      .fn()
      .mockResolvedValue('processing');

    await expect(
      handleWebhookEvent({ eventId: 'event-processing' }, deps)
    ).rejects.toThrow('PayNote webhook event is already being processed');

    expect(
      deps.payNoteRepository.finalizeEventProcessing
    ).not.toHaveBeenCalled();
    expect(
      deps.payNoteRepository.releaseEventProcessing
    ).not.toHaveBeenCalled();
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

  it('ignores document created events after canonical session is established', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        type: 'DOCUMENT_CREATED',
        object: {
          sessionId: 'session-canonical',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
          },
          emitted: [],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-1',
        sessionId: 'session-canonical',
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

    const result = await handleWebhookEvent(
      { eventId: 'event-document-created-late' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.payNoteRepository.savePayNote).not.toHaveBeenCalled();
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(
      result.logs.some(
        entry =>
          entry.message ===
          'PayNote webhook event ignored (document created after canonical session established)'
      )
    ).toBe(true);
  });

  it('ignores epoch-advanced paynote events when canonical session is not resolved even if paynote has known sessions', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        type: 'DOCUMENT_EPOCH_ADVANCED',
        object: {
          sessionId: 'session-shadow',
          epoch: 3,
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Capture Funds Requested',
              requestId: 'capture-shadow-request',
              amount: 100,
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
    deps.payNoteRepository.getPayNote = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      sessionIds: ['session-canonical'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    deps.contractRepository.getContractByDocumentId = vi
      .fn()
      .mockResolvedValue(null);

    const result = await handleWebhookEvent(
      { eventId: 'event-shadow-2' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.payNoteRepository.savePayNote).not.toHaveBeenCalled();
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(
      result.logs.some(
        entry =>
          entry.message ===
          'PayNote webhook event ignored (canonical session not established yet)'
      )
    ).toBe(true);
  });

  it('ignores epoch-advanced paynote events when canonical session is not established', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        type: 'DOCUMENT_EPOCH_ADVANCED',
        object: {
          sessionId: 'session-unknown',
          epoch: 5,
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
          },
          emitted: [],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'doc-epoch-only',
        sessionId: 'session-unknown',
        document: {
          type: 'PayNote/PayNote',
          payerAccountNumber: { value: '1234567890' },
        },
      },
    } as MyOsFetchDocumentResult);
    deps.payNoteRepository.getPayNote = vi.fn().mockResolvedValue(null);
    deps.contractRepository.getContractByDocumentId = vi
      .fn()
      .mockResolvedValue(null);

    const result = await handleWebhookEvent({ eventId: 'event-epoch-5' }, deps);

    expect(result.note).toBe('');
    expect(deps.payNoteRepository.savePayNote).not.toHaveBeenCalled();
    expect(
      result.logs.some(
        entry =>
          entry.message ===
          'PayNote webhook event ignored (canonical session not established yet)'
      )
    ).toBe(true);
  });

  it('ignores stale source events that arrive out of order and would downgrade document state', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        id: 'event-stale-created',
        type: 'DOCUMENT_CREATED',
        created: '2026-02-24T11:45:50.086Z',
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            voucherOffer: {
              paymentMandateStatus: 'pending',
            },
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
          voucherOffer: {
            paymentMandateStatus: 'pending',
          },
        },
      },
    } as MyOsFetchDocumentResult);
    deps.payNoteRepository.getPayNote = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      sessionIds: ['session-1'],
      lastSourceEventCreatedAt: '2026-02-24T11:46:02.395Z',
      document: {
        type: 'PayNote/PayNote',
        voucherOffer: {
          paymentMandateStatus: 'attached',
        },
      },
      createdAt: '2026-02-24T11:45:55.811Z',
      updatedAt: '2026-02-24T11:46:05.192Z',
    });

    const result = await handleWebhookEvent(
      { eventId: 'event-stale-created' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.payNoteRepository.savePayNote).not.toHaveBeenCalled();
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(
      result.logs.some(
        entry =>
          entry.message ===
          'PayNote webhook event ignored (older than last processed source event)'
      )
    ).toBe(true);
  });

  it('ignores source events with lower epoch order than already persisted state', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        id: 'event-created-after-epoch',
        type: 'DOCUMENT_CREATED',
        created: '2026-02-24T11:50:00.000Z',
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
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
        },
      },
    } as MyOsFetchDocumentResult);
    deps.payNoteRepository.getPayNote = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      sessionIds: ['session-1'],
      lastSourceEventEpoch: 2,
      lastSourceEventCreatedAt: '2026-02-24T11:45:00.000Z',
      document: {
        type: 'PayNote/PayNote',
      },
      createdAt: '2026-02-24T11:40:00.000Z',
      updatedAt: '2026-02-24T11:45:00.000Z',
    });

    const result = await handleWebhookEvent(
      { eventId: 'event-created-after-epoch' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.payNoteRepository.savePayNote).not.toHaveBeenCalled();
    expect(deps.myOsClient.runDocumentOperation).not.toHaveBeenCalled();
    expect(
      result.logs.some(
        entry =>
          entry.message ===
          'PayNote webhook event ignored (older than last processed source epoch)'
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
        idempotencyKey: 'paynote-transfer:capture-funds:doc-1:event:event-1:0',
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
        idempotencyKey: 'paynote-transfer:reserve-funds:doc-1:event:event-1:0',
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

  it('resolves merchant credit line as counterparty when transfer capture lacks payee account number', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'doc-1',
      holdId: 'hold-1',
      accountNumber: '1234567890',
      merchantId: 'merchant-123',
      transactionId: 'txn-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    deps.bankingFacade.getActiveCreditLineAccountByMerchantId = vi
      .fn()
      .mockResolvedValue({
        id: 'merchant-credit-line-id',
        accountNumber: '2222222222',
        ownerUserId: 'merchant-owner',
      });
    deps.bankingFacade.captureHold = vi.fn().mockResolvedValue({
      holdId: 'hold-1',
      relatedTransactionId: 'txn-2',
    } as any);
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/PayNote',
            payerAccountNumber: { value: '1234567890' },
            name: 'Capture-only PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Capture Funds Requested',
              requestId: 'capture-no-payee-1',
              amount: 1400,
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
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent(
      { eventId: 'event-no-payee-1' },
      deps
    );

    expect(result.note).toBe('');
    expect(
      deps.bankingFacade.getActiveCreditLineAccountByMerchantId
    ).toHaveBeenCalledWith('merchant-123');
    expect(deps.bankingFacade.captureHold).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'hold-1',
        amountMinor: 1400,
        userId: 'user-123',
        counterpartyAccountNumber: '2222222222',
        payNoteDocumentId: 'doc-1',
      })
    );
    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;
    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Funds Captured');
  });

  it('rejects merchant-to-customer capture request when payment mandate id is missing', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'voucher-doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      holdId: 'voucher-hold-1',
      transactionId: 'txn-root-1',
      payerAccountNumber: '4444444444',
      payeeAccountNumber: '1234567890',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Merchant To Customer PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Capture Funds Requested',
              requestId: 'voucher-capture-no-mandate-1',
              amount: 500,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'voucher-doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/Merchant To Customer PayNote',
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent(
      { eventId: 'event-voucher-capture-no-mandate-1' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.bankingFacade.captureHold).not.toHaveBeenCalled();
    expect(
      (
        deps.myOsClient.runDocumentOperation as unknown as {
          mock: { calls: Array<Array<{ operation?: string }>> };
        }
      ).mock.calls.some(call => call[0]?.operation === 'authorizeSpend')
    ).toBe(false);

    const payload = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls.at(-1)?.[0]?.payload;
    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Capture Declined');
    const declined = parseGuarantorUpdatePayloadEvents(payload).find(event => {
      const type = event.type as { blueId?: string } | undefined;
      return type?.blueId === resolveTypeBlueId('PayNote/Capture Declined');
    });
    expect(declined?.reason).toBe('Missing payment mandate document id.');
    expect(JSON.stringify(declined)).toContain('voucher-capture-no-mandate-1');
  });

  it('finalizes merchant-to-customer capture after async payment mandate authorization response', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const payNoteDocumentId = 'voucher-doc-async-1';
    const payNoteSessionId = 'voucher-session-async-1';
    const mandateDocumentId = 'mandate-doc-async-1';
    const mandateSessionId = 'mandate-session-async-1';
    const requestEventId = 'event-voucher-capture-async-request-1';
    const responseEventId = 'event-voucher-capture-async-response-1';
    const requestId = 'voucher-capture-async-1';
    const chargeAttemptId = `${payNoteDocumentId}:${requestEventId}:0`;

    deps.contractRepository.getContractByDocumentId = vi
      .fn()
      .mockImplementation(async documentId => {
        if (documentId === mandateDocumentId) {
          return {
            contractId: 'mandate-contract-async-1',
            typeBlueId: 'paynote-payment-mandate-type',
            displayName: 'Payment Mandate',
            sessionId: mandateSessionId,
            documentId: mandateDocumentId,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          };
        }
        if (documentId === payNoteDocumentId) {
          return {
            contractId: 'voucher-contract-async-1',
            typeBlueId: 'paynote-merchant-to-customer-type',
            displayName: 'Voucher PayNote',
            sessionId: payNoteSessionId,
            documentId: payNoteDocumentId,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          };
        }
        return null;
      });

    const payNoteRecord = {
      payNoteDocumentId,
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      holdId: 'voucher-hold-1',
      transactionId: 'txn-root-1',
      payerAccountNumber: '4444444444',
      payeeAccountNumber: '1234567890',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      document: {
        type: 'PayNote/Merchant To Customer PayNote',
      },
    };

    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async sessionId => {
        if (sessionId === payNoteSessionId) {
          return payNoteRecord;
        }
        return null;
      });
    deps.payNoteRepository.getPayNote = vi.fn().mockImplementation(async id => {
      if (id === payNoteDocumentId) {
        return payNoteRecord;
      }
      return null;
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
      holdId: 'voucher-hold-1',
      relatedTransactionId: 'voucher-txn-async-1',
    } as any);

    fetchEvent.mockImplementation(async eventId => {
      if (eventId === requestEventId) {
        return {
          kind: 'success',
          payload: {
            object: {
              sessionId: payNoteSessionId,
              document: {
                type: 'PayNote/Merchant To Customer PayNote',
              },
              emitted: [
                toOfficialBlue({
                  type: 'PayNote/Capture Funds Requested',
                  requestId,
                  amount: 500,
                  paymentMandateDocumentId: mandateDocumentId,
                }),
              ],
            },
          },
        } as MyOsFetchEventResult;
      }

      if (eventId === responseEventId) {
        return {
          kind: 'success',
          payload: {
            object: {
              sessionId: mandateSessionId,
              document: {
                type: 'PayNote/Payment Mandate',
              },
              emitted: [
                toOfficialBlue({
                  type: 'PayNote/Payment Mandate Spend Authorization Responded',
                  chargeAttemptId,
                  status: 'approved',
                  remainingAmountMinor: 49_500,
                  respondedAt: '2024-01-01T00:00:01.000Z',
                }),
              ],
            },
          },
        } as MyOsFetchEventResult;
      }

      return {
        kind: 'not-found',
        status: 404,
      } as MyOsFetchEventResult;
    });

    fetchDocument.mockImplementation(async sessionId => {
      if (sessionId === payNoteSessionId) {
        return {
          kind: 'success',
          document: {
            documentId: payNoteDocumentId,
            sessionId: payNoteSessionId,
            document: {
              type: 'PayNote/Merchant To Customer PayNote',
            },
          },
        } as MyOsFetchDocumentResult;
      }

      if (sessionId === mandateSessionId) {
        return {
          kind: 'success',
          document: {
            documentId: mandateDocumentId,
            sessionId: mandateSessionId,
            document: {
              type: 'PayNote/Payment Mandate',
              granterType: 'merchant',
              sourceAccount: 'root',
              granteeType: 'documentId',
              granteeId: payNoteDocumentId,
              amountLimit: 100_000,
              currency: 'USD',
            },
          },
        } as MyOsFetchDocumentResult;
      }

      return {
        kind: 'not-found',
        status: 404,
      } as MyOsFetchDocumentResult;
    });

    const first = await handleWebhookEvent({ eventId: requestEventId }, deps);
    expect(first.note).toBe('');
    expect(deps.bankingFacade.captureHold).not.toHaveBeenCalled();

    const afterFirstCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<Array<{ payload?: unknown; operation?: string }>>;
        };
      }
    ).mock.calls;
    expect(
      afterFirstCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Capture Declined'
        )
      )
    ).toBe(false);

    const second = await handleWebhookEvent({ eventId: responseEventId }, deps);
    expect(second.note).toBe('');
    expect(deps.bankingFacade.captureHold).toHaveBeenCalledTimes(1);
    expect(deps.bankingFacade.captureHold).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'voucher-hold-1',
        amountMinor: 500,
        userId: 'merchant-owner',
        payNoteDocumentId,
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<
            Array<{ operation?: string; sessionId?: string; payload?: unknown }>
          >;
        };
      }
    ).mock.calls;
    expect(
      runOperationCalls.some(
        call =>
          call[0]?.operation === 'settleSpend' &&
          call[0]?.sessionId === mandateSessionId
      )
    ).toBe(true);
    expect(
      runOperationCalls.some(call =>
        runOperationPayloadContainsEventType(
          call[0]?.payload,
          'PayNote/Funds Captured'
        )
      )
    ).toBe(true);
  });

  it('authorizes and settles merchant-to-customer capture request via payment mandate', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId, mandateSessionId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'voucher-doc-1',
      mandateDocument: buildPaymentMandateDocument({
        granteeId: 'voucher-doc-1',
      }),
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'voucher-doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      holdId: 'voucher-hold-1',
      transactionId: 'txn-root-1',
      payerAccountNumber: '4444444444',
      payeeAccountNumber: '1234567890',
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
      holdId: 'voucher-hold-1',
      relatedTransactionId: 'voucher-txn-1',
    } as any);

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Merchant To Customer PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Capture Funds Requested',
              requestId: 'voucher-capture-with-mandate-1',
              amount: 500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'voucher-doc-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/Merchant To Customer PayNote',
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent(
      { eventId: 'event-voucher-capture-with-mandate-1' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.bankingFacade.captureHold).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'voucher-hold-1',
        amountMinor: 500,
        userId: 'merchant-owner',
        payNoteDocumentId: 'voucher-doc-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<
            Array<{ operation?: string; sessionId?: string; payload?: unknown }>
          >;
        };
      }
    ).mock.calls;
    const authorizeCall = runOperationCalls.find(
      call =>
        call[0]?.operation === 'authorizeSpend' &&
        call[0]?.sessionId === mandateSessionId
    );
    expect(authorizeCall).toBeTruthy();
    expect(authorizeCall?.[0]?.payload).toEqual(
      expect.objectContaining({
        type: 'PayNote/Payment Mandate Spend Authorization Requested',
      })
    );

    const settleCall = runOperationCalls.find(
      call =>
        call[0]?.operation === 'settleSpend' &&
        call[0]?.sessionId === mandateSessionId
    );
    expect(settleCall).toBeTruthy();
    expect(settleCall?.[0]?.payload).toEqual(
      expect.objectContaining({
        type: 'PayNote/Payment Mandate Spend Settled',
        status: 'succeeded',
        reservedDeltaMinor: -500,
        capturedDeltaMinor: 500,
      })
    );

    const payload = runOperationCalls.at(-1)?.[0]?.payload;
    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Funds Captured');
    const simpleEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(JSON.stringify(simpleEvents)).toContain(
      'voucher-capture-with-mandate-1'
    );
  });

  it('authorizes and settles merchant-to-customer capture request when mandate chargeAttempts are wrapped', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const mandateDocumentId = 'mandate-doc-official-1';
    const mandateSessionId = 'mandate-session-official-1';
    const eventId = 'event-voucher-capture-with-mandate-official-1';
    const chargeAttemptId =
      'voucher-doc-1:event-voucher-capture-with-mandate-official-1:0';
    const previousFetchDocumentImpl = fetchDocument.getMockImplementation();

    deps.contractRepository.getContractByDocumentId = vi
      .fn()
      .mockImplementation(async documentId => {
        if (documentId !== mandateDocumentId) {
          return null;
        }
        return {
          contractId: 'mandate-contract-official-1',
          typeBlueId: 'paynote-payment-mandate-type',
          displayName: 'Payment Mandate',
          sessionId: mandateSessionId,
          documentId: mandateDocumentId,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        };
      });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'voucher-doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      holdId: 'voucher-hold-1',
      transactionId: 'txn-root-1',
      payerAccountNumber: '4444444444',
      payeeAccountNumber: '1234567890',
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
      holdId: 'voucher-hold-1',
      relatedTransactionId: 'voucher-txn-official-1',
    } as any);

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Merchant To Customer PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Capture Funds Requested',
              requestId: 'voucher-capture-with-mandate-official-1',
              amount: 500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    fetchDocument.mockImplementation(async sessionId => {
      if (sessionId === mandateSessionId) {
        return {
          kind: 'success',
          document: {
            documentId: mandateDocumentId,
            sessionId: mandateSessionId,
            document: toOfficialBlue({
              type: 'PayNote/Payment Mandate',
              granterType: 'merchant',
              sourceAccount: 'root',
              granteeType: 'documentId',
              granteeId: 'voucher-doc-1',
              amountLimit: 100_000,
              currency: 'USD',
              chargeAttempts: {
                [chargeAttemptId]: {
                  authorizationStatus: 'approved',
                  authorizationReason: '',
                  authorizedAmountMinor: 500,
                  settled: false,
                },
              },
            }),
          },
        } as MyOsFetchDocumentResult;
      }

      if (sessionId === 'session-1') {
        return {
          kind: 'success',
          document: {
            documentId: 'voucher-doc-1',
            sessionId: 'session-1',
            document: {
              type: 'PayNote/Merchant To Customer PayNote',
            },
          },
        } as MyOsFetchDocumentResult;
      }

      if (previousFetchDocumentImpl) {
        const result = await previousFetchDocumentImpl(sessionId);
        return result as MyOsFetchDocumentResult;
      }

      return {
        kind: 'not-found',
        status: 404,
      } as MyOsFetchDocumentResult;
    });

    const result = await handleWebhookEvent({ eventId }, deps);

    expect(result.note).toBe('');
    expect(deps.bankingFacade.captureHold).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'voucher-hold-1',
        amountMinor: 500,
        userId: 'merchant-owner',
        payNoteDocumentId: 'voucher-doc-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<
            Array<{ operation?: string; sessionId?: string; payload?: unknown }>
          >;
        };
      }
    ).mock.calls;

    expect(
      runOperationCalls.some(
        call =>
          call[0]?.operation === 'authorizeSpend' &&
          call[0]?.sessionId === mandateSessionId
      )
    ).toBe(true);
    expect(
      runOperationCalls.some(
        call =>
          call[0]?.operation === 'settleSpend' &&
          call[0]?.sessionId === mandateSessionId
      )
    ).toBe(true);

    const payload = runOperationCalls.at(-1)?.[0]?.payload;
    expectGuarantorUpdatePayloadEvent(payload, 'PayNote/Funds Captured');
    const simpleEvents = parseGuarantorUpdatePayloadEvents(payload);
    expect(JSON.stringify(simpleEvents)).toContain(
      'voucher-capture-with-mandate-official-1'
    );
  });

  it('reuses reserve mandate authorization for subsequent capture in merchant-to-customer paynote', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId, mandateSessionId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'voucher-doc-reserve-capture-1',
      mandateDocument: buildPaymentMandateDocument({
        granteeId: 'voucher-doc-reserve-capture-1',
      }),
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'voucher-doc-reserve-capture-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      transactionId: 'txn-root-1',
      payerAccountNumber: '4444444444',
      payeeAccountNumber: '1234567890',
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
      holdId: 'voucher-doc-reserve-capture-1',
      relatedTransactionId: 'voucher-txn-2',
    } as any);

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Merchant To Customer PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reserve Funds Requested',
              requestId: 'voucher-reserve-with-mandate-1',
              amount: 700,
              paymentMandateDocumentId: mandateDocumentId,
            }),
            toOfficialBlue({
              type: 'PayNote/Capture Funds Requested',
              requestId: 'voucher-capture-after-reserve-1',
              amount: 700,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'voucher-doc-reserve-capture-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/Merchant To Customer PayNote',
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent(
      { eventId: 'event-voucher-reserve-capture-1' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'voucher-doc-reserve-capture-1',
        amountMinor: 700,
        payNoteDocumentId: 'voucher-doc-reserve-capture-1',
      })
    );
    expect(deps.bankingFacade.captureHold).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'voucher-doc-reserve-capture-1',
        amountMinor: 700,
        payNoteDocumentId: 'voucher-doc-reserve-capture-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<
            Array<{ operation?: string; sessionId?: string; payload?: unknown }>
          >;
        };
      }
    ).mock.calls;
    const authorizeCalls = runOperationCalls.filter(
      call =>
        call[0]?.operation === 'authorizeSpend' &&
        call[0]?.sessionId === mandateSessionId
    );
    expect(authorizeCalls).toHaveLength(1);
    expect(authorizeCalls[0]?.[0]?.payload).toEqual(
      expect.objectContaining({
        type: 'PayNote/Payment Mandate Spend Authorization Requested',
        chargeMode: 'authorize_only',
      })
    );

    const settleCalls = runOperationCalls.filter(
      call =>
        call[0]?.operation === 'settleSpend' &&
        call[0]?.sessionId === mandateSessionId
    );
    expect(settleCalls).toHaveLength(2);

    const reserveSettlePayload = settleCalls[0]?.[0]?.payload as
      | Record<string, unknown>
      | undefined;
    const captureSettlePayload = settleCalls[1]?.[0]?.payload as
      | Record<string, unknown>
      | undefined;
    expect(reserveSettlePayload).toEqual(
      expect.objectContaining({
        type: 'PayNote/Payment Mandate Spend Settled',
        status: 'succeeded',
        reservedDeltaMinor: 0,
        capturedDeltaMinor: 0,
      })
    );
    expect(captureSettlePayload).toEqual(
      expect.objectContaining({
        type: 'PayNote/Payment Mandate Spend Settled',
        status: 'succeeded',
        reservedDeltaMinor: -700,
        capturedDeltaMinor: 700,
      })
    );
    expect(captureSettlePayload?.chargeAttemptId).toBe(
      reserveSettlePayload?.chargeAttemptId
    );
  });

  it('authorizes and settles merchant-to-customer capture immediately request via payment mandate', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId, mandateSessionId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'voucher-doc-capture-immediately-1',
      mandateDocument: buildPaymentMandateDocument({
        granteeId: 'voucher-doc-capture-immediately-1',
      }),
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'voucher-doc-capture-immediately-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      transactionId: 'txn-root-1',
      payerAccountNumber: '4444444444',
      payeeAccountNumber: '1234567890',
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
            type: 'PayNote/Merchant To Customer PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reserve Funds and Capture Immediately Requested',
              requestId: 'voucher-capture-immediately-with-mandate-1',
              amount: 900,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);
    fetchDocument.mockResolvedValueOnce({
      kind: 'success',
      document: {
        documentId: 'voucher-doc-capture-immediately-1',
        sessionId: 'session-1',
        document: {
          type: 'PayNote/Merchant To Customer PayNote',
        },
      },
    } as MyOsFetchDocumentResult);

    const result = await handleWebhookEvent(
      { eventId: 'event-voucher-capture-immediately-with-mandate-1' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.bankingFacade.transferFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccountId: 'merchant-credit-line-id',
        destinationAccountNumber: '1234567890',
        amountMinor: 900,
        payNoteDocumentId: 'voucher-doc-capture-immediately-1',
      })
    );

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<
            Array<{ operation?: string; sessionId?: string; payload?: unknown }>
          >;
        };
      }
    ).mock.calls;

    const authorizeCall = runOperationCalls.find(
      call =>
        call[0]?.operation === 'authorizeSpend' &&
        call[0]?.sessionId === mandateSessionId
    );
    expect(authorizeCall?.[0]?.payload).toEqual(
      expect.objectContaining({
        type: 'PayNote/Payment Mandate Spend Authorization Requested',
        chargeMode: 'authorize_and_capture',
      })
    );

    const settleCall = runOperationCalls.find(
      call =>
        call[0]?.operation === 'settleSpend' &&
        call[0]?.sessionId === mandateSessionId
    );
    expect(settleCall?.[0]?.payload).toEqual(
      expect.objectContaining({
        type: 'PayNote/Payment Mandate Spend Settled',
        status: 'succeeded',
        reservedDeltaMinor: -900,
        capturedDeltaMinor: 900,
      })
    );
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

  it('processes repeated capture immediately requests with the same requestId when webhook event ids differ', async () => {
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

  it('processes repeated capture immediately requests when requestId is missing and webhook event ids differ', async () => {
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
        chargeAttemptId: 'doc-1:event-1:0',
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
        chargeAttemptId: 'doc-1:event-1:0',
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
            action => action.type === 'paymentMandateBootstrapApproval'
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

    let payNoteRecord: Record<string, unknown> = {
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
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'session-1' ? payNoteRecord : null
      );
    deps.payNoteRepository.savePayNote = vi
      .fn()
      .mockImplementation(async next => {
        payNoteRecord = {
          ...payNoteRecord,
          ...(next as Record<string, unknown>),
        };
      });
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
            action => action.type === 'paymentMandateBootstrapApproval'
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
              action => action.type === 'paymentMandateBootstrapApproval'
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
          type: 'paymentMandateBootstrapApproval',
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

  it('defers charge when mandate document cannot be loaded even with accepted local action', async () => {
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
          type: 'paymentMandateBootstrapApproval',
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
    expect(respondedEvent).toBeUndefined();

    expect(deps.payNoteRepository.savePayNote).toHaveBeenCalled();
    const savedPayNotes = (
      deps.payNoteRepository.savePayNote as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls.map(call => call[0] as Record<string, unknown>);
    const deferredAttempt = savedPayNotes
      .map(
        saved =>
          toSimpleRecord(saved.pendingMandateChargeAttempts)?.[
            'doc-1:event-1:0'
          ]
      )
      .find(Boolean) as Record<string, unknown> | undefined;
    expect(deferredAttempt).toBeDefined();
    expect(deferredAttempt?.eventType).toBe(
      'PayNote/Linked Card Charge Requested'
    );
    expect(deferredAttempt?.retryCount).toBe(1);
    expect(deferredAttempt?.nextRetryAt).toBe('2024-01-01T00:00:01.000Z');
    expect(deferredAttempt?.lastReason).toBe(
      'Unable to load payment mandate document.'
    );
  });

  it('defers charge when mandate contract mapping is missing even if delivery has mandate linkage', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();

    fetchDocument.mockImplementation(async sessionId => {
      if (sessionId === 'session-1') {
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
      }

      return {
        kind: 'success',
        document: {
          documentId: 'doc-1',
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Card Transaction PayNote',
          },
        },
      } as MyOsFetchDocumentResult;
    });

    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      mandateDocumentId: 'mandate-doc-delivery-link-1',
      mandateSessionId: 'mandate-session-delivery-link-1',
      autoApproveAuthorization: true,
    });

    deps.contractRepository.getContractByDocumentId = vi
      .fn()
      .mockResolvedValue(null);
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
      paymentMandateDocumentId: mandateDocumentId,
      paymentMandateBootstrapSessionId: 'mandate-session-delivery-link-1',
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
              requestId: 'charge-delivery-mandate-link-1',
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
          calls: Array<
            Array<{ sessionId?: string; operation?: string; payload?: unknown }>
          >;
        };
      }
    ).mock.calls;
    expect(
      runOperationCalls.some(call => call[0]?.operation === 'authorizeSpend')
    ).toBe(false);

    const savedPayNotes = (
      deps.payNoteRepository.savePayNote as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls.map(call => call[0] as Record<string, unknown>);
    const deferredAttempt = savedPayNotes
      .map(
        saved =>
          toSimpleRecord(saved.pendingMandateChargeAttempts)?.[
            'doc-1:event-1:0'
          ]
      )
      .find(Boolean) as Record<string, unknown> | undefined;
    expect(deferredAttempt).toBeDefined();
    expect(deferredAttempt?.retryCount).toBe(1);
    expect(deferredAttempt?.lastReason).toBe(
      'Unable to resolve payment mandate session id.'
    );
  });

  it('waits for mandate response when mandate authorization is not yet confirmed', async () => {
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
    expect(respondedEvent).toBeUndefined();

    const savedPayNotes = (
      deps.payNoteRepository.savePayNote as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls.map(call => call[0] as Record<string, unknown>);
    const deferredAttempt = savedPayNotes
      .map(
        saved =>
          toSimpleRecord(saved.pendingMandateChargeAttempts)?.[
            'doc-1:event-1:0'
          ]
      )
      .find(Boolean) as Record<string, unknown> | undefined;

    expect(deferredAttempt).toBeDefined();
    expect(deferredAttempt?.eventType).toBe(
      'PayNote/Linked Card Charge Requested'
    );
    expect(deferredAttempt?.retryCount).toBe(1);
    expect(deferredAttempt?.lastReason).toBe(
      'Payment mandate authorization not yet confirmed.'
    );
    expect(deferredAttempt?.requiresAuthorizeDispatch).toBe(false);
  });

  it('keeps deferred charge attempt queued when mandate is still pending during retry', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      autoApproveAuthorization: false,
    });

    deps.clock.now = () => new Date('2024-01-01T00:00:02.000Z');

    const chargeAttemptId = 'doc-1:event-1:0';
    let payNoteRecord: Record<string, unknown> = {
      payNoteDocumentId: 'doc-1',
      deliveryId: 'delivery-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      pendingMandateChargeAttempts: {
        [chargeAttemptId]: {
          mandateDocumentId,
          eventType: 'PayNote/Linked Card Charge Requested',
          requestId: 'charge-pending-retry-1',
          queuedAt: '2024-01-01T00:00:00.000Z',
          retryCount: 1,
          nextRetryAt: '2024-01-01T00:00:01.000Z',
          lastReason: 'Payment mandate authorization not yet confirmed.',
        },
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    deps.payNoteRepository.getPayNoteBySessionId = vi
      .fn()
      .mockImplementation(async (sessionId: string) =>
        sessionId === 'session-1' ? payNoteRecord : null
      );
    deps.payNoteRepository.savePayNote = vi
      .fn()
      .mockImplementation(async next => {
        payNoteRecord = {
          ...payNoteRecord,
          ...(next as Record<string, unknown>),
        };
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
              requestId: 'charge-pending-retry-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult;

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: { type: 'PayNote/Card Transaction PayNote' },
          emitted: [],
        },
      },
    } as MyOsFetchEventResult);
    fetchEvent.mockResolvedValueOnce(originatingPayload);
    const result = await handleWebhookEvent({ eventId: 'event-2' }, deps);
    expect(result.note).toBe('');

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<Array<{ payload?: unknown; operation?: string }>>;
        };
      }
    ).mock.calls;
    const authorizeCalls = runOperationCalls.filter(
      call => call[0]?.operation === 'authorizeSpend'
    );
    expect(authorizeCalls).toHaveLength(0);
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

    const savedPayNotes = (
      deps.payNoteRepository.savePayNote as unknown as {
        mock: { calls: Array<Array<Record<string, unknown>>> };
      }
    ).mock.calls.map(call => call[0] as Record<string, unknown>);
    const deferredAttempt = savedPayNotes
      .map(
        saved =>
          toSimpleRecord(saved.pendingMandateChargeAttempts)?.[chargeAttemptId]
      )
      .find(Boolean) as Record<string, unknown> | undefined;

    expect(deferredAttempt).toBeDefined();
    expect(deferredAttempt?.retryCount).toBe(1);
    expect(deferredAttempt?.nextRetryAt).toBe('2024-01-01T00:00:01.000Z');
    expect(deferredAttempt?.lastReason).toBe(
      'Payment mandate authorization not yet confirmed.'
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
              chargeAttemptId: 'doc-1:event-1:0',
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

    const chargeAttemptId = 'doc-1:event-1:0';
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
    expect(respondedEvents.map(event => event.status)).toEqual(['accepted']);
    const completedEvent = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Card Charge Completed'
    );
    expect(completedEvent?.status).toBe('succeeded');
  });

  it('retries mandate authorization response after transient processing failure', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId, mandateSessionId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'doc-1',
      autoApproveAuthorization: false,
    });

    const processingMarkers = new Set<string>();
    const completedMarkers = new Set<string>();
    deps.payNoteRepository.markEventProcessed = vi
      .fn()
      .mockImplementation(async (marker: string) => {
        if (processingMarkers.has(marker) || completedMarkers.has(marker)) {
          return false;
        }
        processingMarkers.add(marker);
        return true;
      });
    deps.payNoteRepository.getEventProcessingStatus = vi
      .fn()
      .mockImplementation(async (marker: string) => {
        if (processingMarkers.has(marker)) {
          return 'processing';
        }
        if (completedMarkers.has(marker)) {
          return 'completed';
        }
        return null;
      });
    deps.payNoteRepository.finalizeEventProcessing = vi
      .fn()
      .mockImplementation(async (marker: string) => {
        if (processingMarkers.delete(marker)) {
          completedMarkers.add(marker);
        }
      });
    deps.payNoteRepository.releaseEventProcessing = vi
      .fn()
      .mockImplementation(async (marker: string) => {
        processingMarkers.delete(marker);
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
              requestId: 'charge-retry-1',
              amount: 2500,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult;

    fetchEvent.mockResolvedValueOnce(originatingPayload);
    const initial = await handleWebhookEvent({ eventId: 'event-origin' }, deps);
    expect(initial.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).not.toHaveBeenCalled();

    const runDocumentOperationMock = deps.myOsClient.runDocumentOperation as
      | ReturnType<typeof vi.fn>
      | undefined;
    const previousRunDocumentOperationImpl =
      runDocumentOperationMock?.getMockImplementation();
    let failGuarantorUpdateOnce = true;
    runDocumentOperationMock?.mockImplementation(async args => {
      if (
        failGuarantorUpdateOnce &&
        args.sessionId === 'session-1' &&
        args.operation === 'guarantorUpdate'
      ) {
        failGuarantorUpdateOnce = false;
        throw new Error('Temporary guarantor update failure');
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

    const mandateResponsePayload = {
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
              chargeAttemptId: 'doc-1:event-origin:0',
              status: 'approved',
            }),
          ],
        },
      },
    } as MyOsFetchEventResult;

    fetchEvent.mockResolvedValueOnce(mandateResponsePayload);
    fetchEvent.mockResolvedValueOnce(originatingPayload);
    await expect(
      handleWebhookEvent({ eventId: 'event-mandate-1' }, deps)
    ).rejects.toThrow('Temporary guarantor update failure');

    fetchEvent.mockResolvedValueOnce(mandateResponsePayload);
    fetchEvent.mockResolvedValueOnce(originatingPayload);
    const retried = await handleWebhookEvent(
      { eventId: 'event-mandate-2' },
      deps
    );
    expect(retried.note).toBe('');

    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledTimes(1);
    const attemptProcessingKey =
      'paynote-card-charge-attempt-processed:doc-1:event-origin:0';
    expect(
      (
        deps.payNoteRepository.releaseEventProcessing as ReturnType<
          typeof vi.fn
        >
      ).mock.calls.some(call => call[0] === attemptProcessingKey)
    ).toBe(true);
    expect(
      (
        deps.payNoteRepository.finalizeEventProcessing as ReturnType<
          typeof vi.fn
        >
      ).mock.calls.some(call => call[0] === attemptProcessingKey)
    ).toBe(true);

    const runOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: { calls: Array<Array<{ payload?: unknown }>> };
      }
    ).mock.calls;
    const respondedEvent = findRunOperationEventByType(
      runOperationCalls,
      'PayNote/Card Charge Responded'
    );
    expect(respondedEvent?.status).toBe('accepted');
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
              chargeAttemptId: 'doc-1:event-1:0',
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
    expect(respondedEvents.map(event => event.status)).toEqual(['rejected']);
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

  it('uses local payer/payee roles for linked card charge in merchant-to-customer paynote', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'voucher-doc-1',
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'voucher-doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      holdId: 'root-hold-1',
      payerAccountNumber: '4444444444',
      payeeAccountNumber: '1234567890',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue(null);
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
            type: 'PayNote/Merchant To Customer PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Linked Card Charge Requested',
              requestId: 'linked-local-roles-1',
              amount: 700,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent(
      { eventId: 'event-linked-1' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'paynote-card-charge:voucher-doc-1:event-linked-1:0',
        payerAccountNumber: '4444444444',
        counterpartyAccountNumber: '1234567890',
        amountMinor: 700,
      })
    );
  });

  it('uses local payer/payee roles for reverse card charge in merchant-to-customer paynote', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'voucher-doc-1',
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'voucher-doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      holdId: 'root-hold-1',
      payerAccountNumber: '4444444444',
      payeeAccountNumber: '1234567890',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue(null);
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
            type: 'PayNote/Merchant To Customer PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reverse Card Charge Requested',
              requestId: 'reverse-local-roles-1',
              amount: 700,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent(
      { eventId: 'event-reverse-1' },
      deps
    );

    expect(result.note).toBe('');
    expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        holdId: 'paynote-card-charge:voucher-doc-1:event-reverse-1:0',
        payerAccountNumber: '1234567890',
        counterpartyAccountNumber: '4444444444',
        amountMinor: 700,
      })
    );
  });

  it('rejects reverse card charge when payer and payee account mapping collides', async () => {
    const { deps, fetchEvent, fetchDocument } = createDependencies();
    const { mandateDocumentId } = attachPaymentMandate({
      deps,
      fetchDocument,
      payNoteDocumentId: 'voucher-doc-1',
    });

    deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
      payNoteDocumentId: 'voucher-doc-1',
      accountNumber: '1234567890',
      userId: 'user-123',
      merchantId: 'merchant-123',
      holdId: 'root-hold-1',
      payerAccountNumber: '1234567890',
      payeeAccountNumber: '1234567890',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue(null);
    deps.bankingFacade.getAccountByNumber = vi.fn().mockResolvedValue({
      id: 'customer-account-id',
      accountNumber: '1234567890',
      ownerUserId: 'customer-owner',
    });

    fetchEvent.mockResolvedValueOnce({
      kind: 'success',
      payload: {
        object: {
          sessionId: 'session-1',
          document: {
            type: 'PayNote/Merchant To Customer PayNote',
          },
          emitted: [
            toOfficialBlue({
              type: 'PayNote/Reverse Card Charge Requested',
              requestId: 'reverse-collide-1',
              amount: 700,
              paymentMandateDocumentId: mandateDocumentId,
            }),
          ],
        },
      },
    } as MyOsFetchEventResult);

    const result = await handleWebhookEvent(
      { eventId: 'event-reverse-collide-1' },
      deps
    );

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
    expect(getString(respondedEvent?.status)).toBe('rejected');
    expect(getString(respondedEvent?.reason)).toBe(
      'Unable to resolve payer/payee account mapping.'
    );
  });

  it.each([
    {
      name: 'linked capture-immediately',
      eventType: 'PayNote/Linked Card Charge and Capture Immediately Requested',
      eventId: 'event-linked-immediate-1',
      requestId: 'linked-local-immediate-1',
      expectedPayerAccountNumber: '4444444444',
      expectedCounterpartyAccountNumber: '1234567890',
      expectedCaptureUserId: 'merchant-owner',
    },
    {
      name: 'reverse capture-immediately',
      eventType:
        'PayNote/Reverse Card Charge and Capture Immediately Requested',
      eventId: 'event-reverse-immediate-1',
      requestId: 'reverse-local-immediate-1',
      expectedPayerAccountNumber: '1234567890',
      expectedCounterpartyAccountNumber: '4444444444',
      expectedCaptureUserId: 'customer-owner',
    },
  ])(
    'uses local payer/payee roles for $name in merchant-to-customer paynote',
    async scenario => {
      const { deps, fetchEvent, fetchDocument } = createDependencies();
      const { mandateDocumentId } = attachPaymentMandate({
        deps,
        fetchDocument,
        payNoteDocumentId: 'voucher-doc-1',
      });

      deps.payNoteRepository.getPayNoteBySessionId = vi.fn().mockResolvedValue({
        payNoteDocumentId: 'voucher-doc-1',
        accountNumber: '1234567890',
        userId: 'user-123',
        merchantId: 'merchant-123',
        holdId: 'root-hold-1',
        payerAccountNumber: '4444444444',
        payeeAccountNumber: '1234567890',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      (deps.payNoteDeliveryRepository.getDelivery as any).mockResolvedValue(
        null
      );
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
        holdId: `paynote-card-charge:voucher-doc-1:${scenario.eventId}:0`,
        relatedTransactionId: `txn-${scenario.eventId}`,
      } as any);

      fetchEvent.mockResolvedValueOnce({
        kind: 'success',
        payload: {
          object: {
            sessionId: 'session-1',
            document: {
              type: 'PayNote/Merchant To Customer PayNote',
            },
            emitted: [
              toOfficialBlue({
                type: scenario.eventType,
                requestId: scenario.requestId,
                amount: 900,
                paymentMandateDocumentId: mandateDocumentId,
              }),
            ],
          },
        },
      } as MyOsFetchEventResult);

      const result = await handleWebhookEvent(
        { eventId: scenario.eventId },
        deps
      );

      expect(result.note).toBe('');
      expect(deps.bankingFacade.reserveFunds).toHaveBeenCalledWith(
        expect.objectContaining({
          holdId: `paynote-card-charge:voucher-doc-1:${scenario.eventId}:0`,
          payerAccountNumber: scenario.expectedPayerAccountNumber,
          counterpartyAccountNumber: scenario.expectedCounterpartyAccountNumber,
          amountMinor: 900,
        })
      );
      expect(deps.bankingFacade.captureHold).toHaveBeenCalledWith(
        expect.objectContaining({
          holdId: `paynote-card-charge:voucher-doc-1:${scenario.eventId}:0`,
          userId: scenario.expectedCaptureUserId,
          counterpartyAccountNumber: scenario.expectedCounterpartyAccountNumber,
          idempotencyKey: `paynote-card-charge:capture:${scenario.eventId}:0`,
          payNoteDocumentId: 'voucher-doc-1',
        })
      );
    }
  );

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
      body: { sessionId: 'linked-paynote-session-1' },
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
            type: 'PayNote/PayNote',
          }),
          channelBindings: {
            payerChannel: { accountId: 'customer-account-id' },
            payeeChannel: { accountId: 'merchant-account-id' },
            guarantorChannel: { accountId: 'account-id' },
          },
        }),
      })
    );
    expect(deps.bootstrapContextRepository.saveContext).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapSessionId: 'linked-paynote-session-1',
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
      body: { sessionId: 'linked-paynote-chain-session-1' },
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
            type: 'PayNote/PayNote',
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

  it('rejects linked paynote startup when mandate policy disallows auto-start', async () => {
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
    expect(deps.myOsClient.bootstrapDocument).not.toHaveBeenCalled();

    const runDocumentOperationCalls = (
      deps.myOsClient.runDocumentOperation as unknown as {
        mock: {
          calls: Array<Array<{ operation?: string; payload?: unknown }>>;
        };
      }
    ).mock.calls;
    const linkedResponded = findRunOperationEventByType(
      runDocumentOperationCalls,
      'PayNote/Linked PayNote Start Responded'
    );
    expect(linkedResponded?.status).toBe('rejected');
    expect(linkedResponded?.reason).toBe(
      'Linked PayNote auto-start is not allowed by payment mandate policy.'
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
      'Linked PayNote startup requires payerChannel and payeeChannel account bindings.'
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
      body: { sessionId: 'voucher-paynote-session-1' },
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
