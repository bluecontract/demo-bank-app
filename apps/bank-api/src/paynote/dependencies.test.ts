import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDependencies, resetDependencies } from './dependencies';

const hoisted = vi.hoisted(() => {
  const logger = { info: vi.fn(), error: vi.fn() };
  const getLogger = vi.fn(() => logger);
  const createOpenAiResolver = vi.fn(() => vi.fn());
  const createMyOsResolver = vi.fn(() => vi.fn());
  return {
    loggerMock: logger,
    getLoggerMock: getLogger,
    createOpenAiApiKeyResolverMock: createOpenAiResolver,
    createMyOsCredentialsResolverMock: createMyOsResolver,
  };
});

vi.mock('../shared/logger', () => ({
  getLogger: hoisted.getLoggerMock,
}));

vi.mock('../shared/openAiSecrets', () => ({
  createOpenAiApiKeyResolver: hoisted.createOpenAiApiKeyResolverMock,
}));

vi.mock('../shared/myOsSecrets', () => ({
  createMyOsCredentialsResolver: hoisted.createMyOsCredentialsResolverMock,
}));

describe('paynote dependencies', () => {
  beforeEach(() => {
    process.env.BANKING_DYNAMO_TABLE_NAME = 'test-paynote-table';
    process.env.AUTH_DYNAMO_TABLE_NAME = 'test-auth-table';
    process.env.JWT_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:test';
    process.env.AWS_REGION = 'us-east-1';
    resetDependencies();
    hoisted.getLoggerMock.mockClear();
    hoisted.createOpenAiApiKeyResolverMock.mockClear();
    hoisted.createMyOsCredentialsResolverMock.mockClear();
    hoisted.loggerMock.info.mockClear();
    hoisted.loggerMock.error.mockClear();
  });

  afterEach(() => {
    delete process.env.BANKING_DYNAMO_TABLE_NAME;
    delete process.env.AUTH_DYNAMO_TABLE_NAME;
    delete process.env.JWT_SECRET_ARN;
    delete process.env.AWS_REGION;
  });

  it('initialises and caches dependencies', async () => {
    const first = await getDependencies();
    const second = await getDependencies();

    expect(hoisted.getLoggerMock).toHaveBeenCalledTimes(1);
    expect(hoisted.createOpenAiApiKeyResolverMock).toHaveBeenCalledTimes(1);
    expect(hoisted.createMyOsCredentialsResolverMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first).toHaveProperty('logger', hoisted.loggerMock);
    expect(typeof first.getOpenAiApiKey).toBe('function');
    expect(typeof first.getMyOsCredentials).toBe('function');
    expect(typeof first.getOpenAiValidationProvider).toBe('function');
  });

  it('re-initialises dependencies after reset', async () => {
    await getDependencies();

    resetDependencies();

    await getDependencies();

    expect(hoisted.getLoggerMock).toHaveBeenCalledTimes(2);
    expect(hoisted.createOpenAiApiKeyResolverMock).toHaveBeenCalledTimes(2);
    expect(hoisted.createMyOsCredentialsResolverMock).toHaveBeenCalledTimes(2);
  });
});
