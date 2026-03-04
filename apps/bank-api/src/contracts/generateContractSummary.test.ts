import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateContractSummaryForSessionId,
  generateContractSummaryHandler,
} from './generateContractSummary';
import { summaryBlue } from './summaryUtils';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';

const hoistedOpenAI = vi.hoisted(() => {
  const responsesParseMock = vi.fn();

  class OpenAIStub {
    public responses = {
      parse: responsesParseMock,
    };

    constructor(public readonly options: { apiKey: string }) {}
  }

  return { responsesParseMock, OpenAIStub };
});

vi.mock('openai', () => ({
  default: hoistedOpenAI.OpenAIStub,
}));

const hoistedDeps = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

vi.mock('../paynote/dependencies', () => ({
  getDependencies: hoistedDeps.getDependenciesMock,
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoistedDeps.extractAuthInfoMock,
}));

const extractFactsFromFirstParseCall = (): Record<string, unknown> => {
  const parseCall = hoistedOpenAI.responsesParseMock.mock.calls[0];
  expect(parseCall).toBeDefined();
  const request = parseCall[0] as {
    input?: Array<{
      content?: Array<{ text?: string }>;
    }>;
  };
  const payload = request.input?.[1]?.content?.[0]?.text;
  expect(typeof payload).toBe('string');
  const match = (payload as string).match(/^<facts>\n?(.*)\n?<\/facts>$/s);
  expect(match?.[1]).toBeDefined();
  return JSON.parse(match![1]) as Record<string, unknown>;
};

describe('generateContractSummaryHandler', () => {
  const payNoteTypeBlueId = paynoteBlueIds['PayNote/PayNote'];
  const documentProcessingInitiatedBlueId =
    'BrpmpNt5JkapeUvPqYcxgXZrHNZX3R757dRwuXXdfNM2';
  const summaryFixture = {
    story: {
      headline: 'PayNote',
      overview: ['A test PayNote.'],
      bullets: ['Funds are held until delivery is confirmed.'],
    },
    listPreview: 'PayNote updated.',
    nextSteps: {
      title: 'Next steps',
      items: ['Awaiting approval from the customer.'],
    },
    lastChange: {
      short: 'PayNote updated.',
      more: 'The contract was updated with the latest delivery status.',
    },
  };
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const getOpenAiApiKey = vi.fn().mockResolvedValue('api-key');
  const contractRepository = {
    getContractBySessionId: vi.fn(),
    updateContractSummary: vi.fn(),
    addContractHistoryEntry: vi.fn(),
    listContractHistory: vi.fn(),
  };
  const merchantDirectoryRepository = {
    getMerchantsByIds: vi.fn(),
  };

  beforeEach(() => {
    hoistedOpenAI.responsesParseMock.mockReset();
    hoistedDeps.getDependenciesMock.mockReset();
    hoistedDeps.extractAuthInfoMock.mockReset();
    contractRepository.getContractBySessionId.mockReset();
    contractRepository.updateContractSummary.mockReset();
    contractRepository.addContractHistoryEntry.mockReset();
    contractRepository.listContractHistory.mockReset();
    merchantDirectoryRepository.getMerchantsByIds.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
    getOpenAiApiKey.mockClear();
    merchantDirectoryRepository.getMerchantsByIds.mockResolvedValue([]);

    contractRepository.listContractHistory.mockResolvedValue([]);

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
      getOpenAiApiKey,
      merchantDirectoryRepository,
    });
    hoistedDeps.extractAuthInfoMock.mockResolvedValue({ userId: 'user-123' });
  });

  it('returns 404 when contract is missing', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce(null);

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: {},
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(404);
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
  });

  it('returns cached summary when fresh and force is false', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      summary: {
        story: {
          headline: 'PayNote',
          overview: ['A test PayNote.'],
          bullets: [],
        },
        listPreview: 'PayNote updated.',
        nextSteps: {
          title: 'Next steps',
          items: ['Awaiting approval from the customer.'],
        },
        lastChange: {
          short: 'PayNote updated.',
          more: 'The contract was updated with the latest delivery status.',
        },
      },
      summaryPreview: 'PayNote updated.',
      summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
      summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      summaryModel: 'gpt-5',
      summaryError: undefined,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: false },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(true);
    expect(result.body.summary.story.headline).toBe('PayNote');
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).not.toHaveBeenCalled();
    expect(contractRepository.addContractHistoryEntry).not.toHaveBeenCalled();
  });

  it('regenerates when forced even if summary preview is missing', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      summary: summaryFixture,
      summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
      summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      summaryModel: 'gpt-5',
      summaryError: undefined,
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(false);
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).toHaveBeenCalled();
    expect(contractRepository.addContractHistoryEntry).toHaveBeenCalled();
  });

  it('accepts two-layer contract overview text from the model response', async () => {
    const summaryWithDetails = {
      ...summaryFixture,
      story: {
        ...summaryFixture.story,
        overview: [
          'This contract covers payment for the ordered goods.',
          'The funds remain secured until delivery is confirmed by the required participant.',
        ],
      },
    };

    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      summary: summaryFixture,
      summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
      summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      summaryModel: 'gpt-5',
      summaryError: undefined,
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryWithDetails,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.summary.story.overview).toEqual([
      'This contract covers payment for the ordered goods.',
      'The funds remain secured until delivery is confirmed by the required participant.',
    ]);
    expect(contractRepository.updateContractSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'sess-1',
        summary: expect.objectContaining({
          story: expect.objectContaining({
            overview: [
              'This contract covers payment for the ordered goods.',
              'The funds remain secured until delivery is confirmed by the required participant.',
            ],
          }),
        }),
      })
    );
  });

  it('repairs summary index fields when returning a cached summary', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      userId: 'user-123',
      relatedTransactionIds: ['txn-1'],
      relatedHoldIds: ['hold-1'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      summary: summaryFixture,
      summaryPreview: 'PayNote updated.',
      summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
      summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      summaryModel: 'gpt-5',
      summaryError: undefined,
    });

    const result = await generateContractSummaryForSessionId({
      sessionId: 'sess-1',
      force: false,
      contractRepository: contractRepository as any,
      getOpenAiApiKey,
      logger: logger as any,
    });

    expect(result).toEqual(
      expect.objectContaining({
        cached: true,
        summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
        summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      })
    );
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'sess-1',
        summaryPreview: 'PayNote',
        summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
        summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
        summaryError: null,
        userId: 'user-123',
        relatedTransactionIds: ['txn-1'],
        relatedHoldIds: ['hold-1'],
      })
    );
    expect(contractRepository.addContractHistoryEntry).not.toHaveBeenCalled();
  });

  it('uses cached summary and derives preview when only summary payload is present', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      summary: summaryFixture,
      summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
      summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      summaryModel: 'gpt-5',
      summaryError: undefined,
    });

    const result = await generateContractSummaryForSessionId({
      sessionId: 'sess-1',
      force: false,
      contractRepository: contractRepository as any,
      getOpenAiApiKey,
      logger: logger as any,
    });

    expect(result?.cached).toBe(true);
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'sess-1',
        summaryPreview: 'PayNote',
        summaryUpdatedAt: '2026-01-02T00:00:01.000Z',
        summarySourceUpdatedAt: '2026-01-02T00:00:00.000Z',
      })
    );
  });

  it('returns 404 when summary is missing and force is false', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: {},
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(404);
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).not.toHaveBeenCalled();
    expect(contractRepository.addContractHistoryEntry).not.toHaveBeenCalled();
  });

  it('generates a new summary when missing and forced', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(false);
    expect(result.body.summary.story.headline).toBe('PayNote');
    expect(getOpenAiApiKey).toHaveBeenCalled();
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).toHaveBeenCalled();
    expect(contractRepository.addContractHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'contractUpdated',
        short: summaryFixture.lastChange.short,
        more: summaryFixture.lastChange.more,
      })
    );
  });

  it('skips adding duplicate history entries when history id matches', async () => {
    const triggerEvent = {
      timestamp: 1767312000000,
      actor: { accountId: 'acct-1' },
    };
    const triggerNode = summaryBlue.jsonValueToNode(triggerEvent);
    const triggerId = summaryBlue.calculateBlueIdSync(triggerNode);

    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      triggerEvent,
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    contractRepository.listContractHistory.mockResolvedValueOnce([
      {
        id: triggerId,
        contractId: 'sess-1',
        kind: 'contractUpdated',
        short: summaryFixture.lastChange.short,
        more: summaryFixture.lastChange.more,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(contractRepository.updateContractSummary).toHaveBeenCalled();
    expect(contractRepository.addContractHistoryEntry).not.toHaveBeenCalled();
  });

  it('uses init history id when trigger event is missing', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:02:00.000Z',
    });

    contractRepository.listContractHistory.mockResolvedValueOnce([]);

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(contractRepository.updateContractSummary).toHaveBeenCalled();
    expect(contractRepository.addContractHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'init:sess-1',
      })
    );
  });

  it('uses static ready fallback without LLM for epoch 0 with only Document Processing Initiated', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      documentId: 'doc-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      emittedEvents: [
        {
          type: { blueId: documentProcessingInitiatedBlueId },
        },
      ],
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:02:00.000Z',
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(false);
    expect(result.body.summary.story.headline).toBe('Contract is ready.');
    expect(result.body.summary.lastChange.short).toBe('Contract is ready.');
    expect(result.body.summary.lastChange.more).toBe(
      'Contract was set up successfully.'
    );
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryModel: null,
        summaryError: null,
      })
    );
    expect(contractRepository.addContractHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'init:doc-1',
        short: 'Contract is ready.',
      })
    );
  });

  it('filters out Document Processing Initiated from LLM facts when other emitted events are present', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      emittedEvents: [
        { type: { blueId: documentProcessingInitiatedBlueId } },
        { type: { value: 'Conversation/Customer Action Requested' } },
      ],
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:02:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalledTimes(1);
    expect(getOpenAiApiKey).toHaveBeenCalledTimes(1);
    const facts = extractFactsFromFirstParseCall();
    const emittedEvents = ((
      facts.transition as { emittedEvents?: unknown[] } | undefined
    )?.emittedEvents ?? []) as unknown[];
    expect(JSON.stringify(emittedEvents)).not.toContain(
      documentProcessingInitiatedBlueId
    );
    expect(JSON.stringify(emittedEvents)).toContain(
      'Conversation/Customer Action Requested'
    );
  });

  it('does not use static ready fallback when epoch 0 has only one non-initiated emitted event', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      emittedEvents: [
        { type: { value: 'Conversation/Customer Action Requested' } },
      ],
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:02:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalledTimes(1);
    const facts = extractFactsFromFirstParseCall();
    const emittedEvents = ((
      facts.transition as { emittedEvents?: unknown[] } | undefined
    )?.emittedEvents ?? []) as unknown[];
    expect(JSON.stringify(emittedEvents)).toContain(
      'Conversation/Customer Action Requested'
    );
  });

  it('keeps Document Processing Initiated in LLM facts when summarySourceEpoch is greater than 0 and there are no business events', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      summarySourceEpoch: 1,
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      emittedEvents: [{ type: { blueId: documentProcessingInitiatedBlueId } }],
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:02:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalledTimes(1);
    const facts = extractFactsFromFirstParseCall();
    const emittedEvents = ((
      facts.transition as { emittedEvents?: unknown[] } | undefined
    )?.emittedEvents ?? []) as unknown[];
    expect(JSON.stringify(emittedEvents)).toContain(
      documentProcessingInitiatedBlueId
    );
  });

  it('does not use static ready fallback when trigger event is present', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {},
      },
      triggerEvent: {
        actor: { accountId: 'bank-account' },
      },
      emittedEvents: [
        { type: { blueId: 'BrpmpNt5JkapeUvPqYcxgXZrHNZX3R757dRwuXXdfNM2' } },
      ],
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:02:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalledTimes(1);
    expect(getOpenAiApiKey).toHaveBeenCalledTimes(1);
  });

  it('marks actorIsViewer=false when trigger actor is not the viewer', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        amount: { total: 500 },
        currency: 'USD',
        contracts: {
          payerChannel: {
            type: 'MyOS/MyOS Timeline Channel',
            accountId: 'viewer-account',
          },
        },
      },
      triggerEvent: {
        timestamp: 1767312000000,
        actor: { accountId: 'bank-account' },
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    const facts = extractFactsFromFirstParseCall();
    const transition = facts.transition as Record<string, unknown> | undefined;
    expect(transition?.actorIsViewer).toBe(false);
  });

  it('passes USD paynote amountDisplay as $x.xx', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        amount: { total: 500 },
        currency: 'USD',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: summaryFixture,
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    const facts = extractFactsFromFirstParseCall();
    const payNoteSummary = facts.payNoteSummary as
      | Record<string, unknown>
      | undefined;
    expect(payNoteSummary?.amountDisplay).toBe('$5.00');
  });

  it('resolves merchant IDs via tool calling when requested by the model', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'Voucher',
      sessionId: 'sess-1',
      merchantId: 'merchant-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Voucher contract',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    merchantDirectoryRepository.getMerchantsByIds.mockResolvedValueOnce([
      {
        merchantId: 'merchant-1',
        name: 'Demo Restaurant',
      },
    ]);

    hoistedOpenAI.responsesParseMock
      .mockResolvedValueOnce({
        id: 'resp-tool-1',
        output: [
          {
            type: 'function_call',
            name: 'resolve_merchant_names',
            call_id: 'call-1',
            arguments: '{"merchantIds":["merchant-1"]}',
            parsed_arguments: {
              merchantIds: ['merchant-1'],
            },
          },
        ],
        output_parsed: null,
      })
      .mockResolvedValueOnce({
        id: 'resp-tool-2',
        output_parsed: summaryFixture,
        output: [],
      });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalledTimes(2);
    expect(merchantDirectoryRepository.getMerchantsByIds).toHaveBeenCalledWith([
      'merchant-1',
    ]);

    const secondCallRequest = hoistedOpenAI.responsesParseMock.mock
      .calls[1]?.[0] as
      | {
          previous_response_id?: string;
          input?: Array<{
            type?: string;
            output?: string;
            call_id?: string;
          }>;
        }
      | undefined;
    expect(secondCallRequest?.previous_response_id).toBe('resp-tool-1');
    expect(secondCallRequest?.input?.[0]?.type).toBe('function_call_output');
    expect(secondCallRequest?.input?.[0]?.call_id).toBe('call-1');
    expect(secondCallRequest?.input?.[0]?.output).toContain('Demo Restaurant');
  });

  it('returns 400 when type pack is missing required type definitions', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: 'unknown-type-blue-id',
      displayName: 'Unknown',
      sessionId: 'sess-1',
      document: {
        type: { blueId: 'unknown-type-blue-id' },
        name: 'Unknown Doc',
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).toHaveBeenCalled();
  });

  it('returns 400 when contracts contain non-type {blueId} stubs', async () => {
    const previousValidationFlag =
      process.env.CONTRACT_SUMMARY_ENFORCE_BLUEID_VALIDATION;
    process.env.CONTRACT_SUMMARY_ENFORCE_BLUEID_VALIDATION = '1';

    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Test PayNote',
        contracts: {
          someRef: { blueId: 'node-blue-id-stub' },
        },
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    try {
      expect(result.status).toBe(400);
      expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
      expect(getOpenAiApiKey).not.toHaveBeenCalled();
      expect(contractRepository.updateContractSummary).toHaveBeenCalled();
    } finally {
      if (previousValidationFlag === undefined) {
        delete process.env.CONTRACT_SUMMARY_ENFORCE_BLUEID_VALIDATION;
      } else {
        process.env.CONTRACT_SUMMARY_ENFORCE_BLUEID_VALIDATION =
          previousValidationFlag;
      }
    }
  });

  it('uses PayNote mock summary fields when LLM summary is disabled', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        name: 'Mocked PayNote',
        LLM_SUMMARY_DISABLED: true,
        payNoteInitialStateDescription: {
          summary: 'Mock summary line',
          details: '## Markdown details',
        },
        contracts: {},
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const result = await generateContractSummaryHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { force: true },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.summary.story.headline).toBe('Mock summary line');
    expect(result.body.summary.story.overview).toEqual(['## Markdown details']);
    expect(result.body.summary.lastChange.short).toBe('Mock summary line');
    expect(result.body.summary.lastChange.more).toBe('Mock summary line');
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'sess-1',
        summaryModel: null,
        summaryError: null,
      })
    );
    expect(contractRepository.addContractHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        short: 'Mock summary line',
        more: 'Mock summary line',
      })
    );
  });
});
