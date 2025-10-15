import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parsePayNotePdfHandler } from './parsePayNotePdf';

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

describe('parsePayNotePdfHandler', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const getOpenAiApiKey = vi.fn().mockResolvedValue('api-key');

  beforeEach(() => {
    hoistedOpenAI.responsesCreateMock.mockReset();
    hoistedOpenAI.responsesParseMock.mockReset();
    hoistedDeps.getDependenciesMock.mockClear();
    hoistedDeps.extractAuthInfoMock.mockClear();
    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      getOpenAiApiKey,
    });
    hoistedDeps.extractAuthInfoMock.mockResolvedValue({ userId: 'user-123' });
    logger.info.mockReset();
    logger.error.mockReset();
    getOpenAiApiKey.mockClear();
  });

  it('returns a validation error when no PDF items are provided', async () => {
    const result = await parsePayNotePdfHandler(
      {
        body: { items: [] },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('VALIDATION_ERROR');
    expect(hoistedOpenAI.responsesCreateMock).not.toHaveBeenCalled();
  });

  it('successfully reconstructs YAML content using the provider', async () => {
    hoistedOpenAI.responsesCreateMock.mockResolvedValue({
      output_text: 'name: example',
    });

    const result = await parsePayNotePdfHandler(
      {
        body: {
          items: [
            {
              str: 'name: example',
              transform: [1, 0, 0, 1, 0, 0],
              width: 10,
              height: 5,
            },
          ],
        },
      } as any,
      { request: {} as any }
    );

    expect(getOpenAiApiKey).toHaveBeenCalled();
    expect(hoistedOpenAI.responsesCreateMock).toHaveBeenCalledWith({
      model: 'gpt-5',
      reasoning: { effort: 'minimal' },
      input: expect.any(Array),
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ yaml: 'name: example' });
  });

  it('returns a problem response when provider parsing fails', async () => {
    hoistedOpenAI.responsesCreateMock.mockResolvedValue({
      output_text: 'ERROR: something went wrong',
    });

    const result = await parsePayNotePdfHandler(
      {
        body: {
          items: [
            {
              str: 'name: example',
              transform: [1, 0, 0, 1, 0, 0],
              width: 10,
              height: 5,
            },
          ],
        },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('PAYNOTE_PARSE_FAILED');
    expect(logger.error).toHaveBeenCalled();
  });
});
