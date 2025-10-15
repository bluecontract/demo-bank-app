import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDependencies, resetDependencies } from './dependencies';

const hoisted = vi.hoisted(() => {
  const logger = { info: vi.fn(), error: vi.fn() };
  const getLogger = vi.fn(() => logger);
  const createResolver = vi.fn(() => vi.fn());
  return {
    loggerMock: logger,
    getLoggerMock: getLogger,
    createOpenAiApiKeyResolverMock: createResolver,
  };
});

vi.mock('../shared/logger', () => ({
  getLogger: hoisted.getLoggerMock,
}));

vi.mock('../shared/openAiSecrets', () => ({
  createOpenAiApiKeyResolver: hoisted.createOpenAiApiKeyResolverMock,
}));

describe('paynote dependencies', () => {
  beforeEach(() => {
    resetDependencies();
    hoisted.getLoggerMock.mockClear();
    hoisted.createOpenAiApiKeyResolverMock.mockClear();
    hoisted.loggerMock.info.mockClear();
    hoisted.loggerMock.error.mockClear();
  });

  it('initialises and caches dependencies', async () => {
    const first = await getDependencies();
    const second = await getDependencies();

    expect(hoisted.getLoggerMock).toHaveBeenCalledTimes(1);
    expect(hoisted.createOpenAiApiKeyResolverMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first).toHaveProperty('logger', hoisted.loggerMock);
    expect(typeof first.getOpenAiApiKey).toBe('function');
  });

  it('re-initialises dependencies after reset', async () => {
    await getDependencies();

    resetDependencies();

    await getDependencies();

    expect(hoisted.getLoggerMock).toHaveBeenCalledTimes(2);
    expect(hoisted.createOpenAiApiKeyResolverMock).toHaveBeenCalledTimes(2);
  });
});
