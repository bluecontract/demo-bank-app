import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateContractSummaryHandler } from './generateContractSummary';
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

describe('generateContractSummaryHandler', () => {
  const payNoteTypeBlueId = paynoteBlueIds['PayNote/PayNote'];
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

  beforeEach(() => {
    hoistedOpenAI.responsesParseMock.mockReset();
    hoistedDeps.getDependenciesMock.mockReset();
    hoistedDeps.extractAuthInfoMock.mockReset();
    contractRepository.getContractBySessionId.mockReset();
    contractRepository.updateContractSummary.mockReset();
    contractRepository.addContractHistoryEntry.mockReset();
    contractRepository.listContractHistory.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
    getOpenAiApiKey.mockClear();

    contractRepository.listContractHistory.mockResolvedValue([]);

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
      getOpenAiApiKey,
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

    expect(result.status).toBe(400);
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
    expect(getOpenAiApiKey).not.toHaveBeenCalled();
    expect(contractRepository.updateContractSummary).toHaveBeenCalled();
  });
});
