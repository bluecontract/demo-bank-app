import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validatePayNoteHandler } from './validatePayNote';

const hoistedOpenAI = vi.hoisted(() => {
  const responsesCreateMock = vi.fn();
  const responsesParseMock = vi.fn();

  class OpenAIStub {
    public responses = {
      create: responsesCreateMock,
      parse: responsesParseMock,
    };
    constructor(public readonly options: { apiKey: string }) {}
  }

  return { responsesCreateMock, responsesParseMock, OpenAIStub };
});

vi.mock('openai', () => ({
  default: hoistedOpenAI.OpenAIStub,
}));

const hoistedZod = vi.hoisted(() => ({
  zodTextFormatMock: vi.fn(() => 'mock-format'),
}));

vi.mock('openai/helpers/zod', () => ({
  zodTextFormat: hoistedZod.zodTextFormatMock,
}));

const hoistedDeps = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

vi.mock('./dependencies', () => ({
  getDependencies: hoistedDeps.getDependenciesMock,
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoistedDeps.extractAuthInfoMock,
}));

describe('validatePayNoteHandler', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const getOpenAiApiKey = vi.fn().mockResolvedValue('api-key');

  beforeEach(() => {
    hoistedOpenAI.responsesCreateMock.mockReset();
    hoistedOpenAI.responsesParseMock.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
    getOpenAiApiKey.mockClear();
    hoistedZod.zodTextFormatMock.mockClear();
    hoistedDeps.getDependenciesMock.mockClear();
    hoistedDeps.extractAuthInfoMock.mockClear();
    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      getOpenAiApiKey,
    });
    hoistedDeps.extractAuthInfoMock.mockResolvedValue({ userId: 'user-123' });
  });

  it('returns a validation error when YAML content is missing', async () => {
    const result = await validatePayNoteHandler(
      {
        body: {
          yamlContent: '',
          formData: {},
        },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('VALIDATION_ERROR');
    expect(hoistedOpenAI.responsesParseMock).not.toHaveBeenCalled();
  });

  it('calls the provider and returns validation results', async () => {
    hoistedOpenAI.responsesParseMock.mockResolvedValue({
      output_parsed: { validationScore: 8, explanation: 'Valid PayNote' },
    });

    const result = await validatePayNoteHandler(
      {
        body: {
          yamlContent: 'name: demo',
          formData: {
            fromAccount: 'account-1',
            totalAmount: '100.00',
          },
        },
      } as any,
      { request: {} as any }
    );

    expect(getOpenAiApiKey).toHaveBeenCalled();
    expect(hoistedZod.zodTextFormatMock).toHaveBeenCalled();
    expect(hoistedOpenAI.responsesParseMock).toHaveBeenCalledWith({
      model: 'gpt-5',
      reasoning: { effort: 'minimal' },
      input: expect.any(Array),
      text: { format: 'mock-format' },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      validationScore: 8,
      explanation: 'Valid PayNote',
    });
  });

  it('handles provider failures gracefully', async () => {
    hoistedOpenAI.responsesParseMock.mockResolvedValue({ output_parsed: null });

    const result = await validatePayNoteHandler(
      {
        body: {
          yamlContent: 'name: demo',
          formData: {},
        },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('VALIDATION_ERROR');
    expect(logger.error).toHaveBeenCalled();
  });
});
