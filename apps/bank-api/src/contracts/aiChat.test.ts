import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contractAiChatHandler } from './aiChat';
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

describe('contractAiChatHandler', () => {
  const payNoteTypeBlueId = paynoteBlueIds['PayNote/PayNote'];
  const logger = {
    error: vi.fn(),
  };
  const getOpenAiApiKey = vi.fn().mockResolvedValue('api-key');
  const contractRepository = {
    getContractBySessionId: vi.fn(),
  };

  beforeEach(() => {
    hoistedOpenAI.responsesParseMock.mockReset();
    hoistedDeps.getDependenciesMock.mockReset();
    hoistedDeps.extractAuthInfoMock.mockReset();
    logger.error.mockReset();
    getOpenAiApiKey.mockClear();
    contractRepository.getContractBySessionId.mockReset();

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
      getOpenAiApiKey,
    });

    hoistedDeps.extractAuthInfoMock.mockResolvedValue({ userId: 'user-123' });
  });

  it('returns 404 when contract is missing', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce(null);

    const result = await contractAiChatHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { messages: [{ role: 'user', content: 'Hi' }] },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(404);
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
  });

  it('downgrades to cannot_do when LLM suggests a non-eligible operation', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        contracts: {
          incrementCounter: {
            type: 'Conversation/Operation',
            channel: 'payeeChannel',
            name: 'Increment counter',
          },
        },
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: {
        assistantMessage: 'Ready.',
        status: 'ready',
        nextProcessingState: 'confirm',
        focus: null,
        operationRequest: {
          type: 'Conversation/Operation Request',
          operation: 'notAllowed',
          request: {},
        },
      },
    });

    const result = await contractAiChatHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { messages: [{ role: 'user', content: 'Run notAllowed' }] },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('cannot_do');
    expect(result.body.operationRequest).toBeNull();
  });

  it('returns ready response when operation is eligible', async () => {
    contractRepository.getContractBySessionId.mockResolvedValueOnce({
      contractId: 'sess-1',
      typeBlueId: payNoteTypeBlueId,
      displayName: 'PayNote',
      sessionId: 'sess-1',
      document: {
        type: { blueId: payNoteTypeBlueId },
        contracts: {
          incrementCounter: {
            type: 'Conversation/Operation',
            channel: 'payeeChannel',
            name: 'Increment counter',
          },
        },
      },
      userId: 'user-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    hoistedOpenAI.responsesParseMock.mockResolvedValueOnce({
      output_parsed: {
        assistantMessage: 'Ready.',
        status: 'ready',
        nextProcessingState: 'confirm',
        focus: null,
        operationRequest: {
          type: 'Conversation/Operation Request',
          operation: 'incrementCounter',
          request: {},
        },
      },
    });

    const result = await contractAiChatHandler(
      {
        params: { sessionId: 'sess-1' },
        body: { messages: [{ role: 'user', content: 'Run increment' }] },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ready');
    expect(result.body.operationRequest).not.toBeNull();
    expect(result.body.operationRequest?.operation).toBe('incrementCounter');
  });
});
