import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validatePayNoteHandler } from './validatePayNote';

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
  const verificationRepository = {
    saveVerification: vi.fn(),
  };
  const validationProvider = {
    validate: vi.fn(),
  };
  const getOpenAiValidationProvider = vi
    .fn()
    .mockResolvedValue(validationProvider);

  beforeEach(() => {
    logger.info.mockReset();
    logger.error.mockReset();
    verificationRepository.saveVerification.mockReset();
    validationProvider.validate.mockReset();
    getOpenAiValidationProvider.mockClear();
    hoistedDeps.getDependenciesMock.mockClear();
    hoistedDeps.extractAuthInfoMock.mockClear();

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      getOpenAiValidationProvider,
      payNoteVerificationRepository: verificationRepository,
      payNoteRepository: {
        getPayNote: vi.fn(),
        getPayNoteBySessionId: vi.fn(),
        savePayNote: vi.fn(),
      },
      payNoteBootstrapRepository: {
        getBootstrapBySessionId: vi.fn(),
        saveBootstrap: vi.fn(),
      },
      bankingRepository: {} as any,
      holdRepository: {} as any,
      bankingFacade: {} as any,
      myOsClient: {} as any,
      getMyOsCredentials: vi.fn(),
      getOpenAiApiKey: vi.fn(),
      blueIdCalculator: {
        fromYaml: vi.fn().mockReturnValue('blue-id-xyz'),
        fromObject: vi.fn(),
        toReversedJson: vi.fn(),
      },
      clock: { now: () => new Date() },
      idGenerator: { generate: vi.fn() },
    });

    hoistedDeps.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-123',
      isTest: false,
    });
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
    expect(validationProvider.validate).not.toHaveBeenCalled();
  });

  it('calls the provider and returns validation results', async () => {
    validationProvider.validate.mockResolvedValue({
      validationScore: 8,
      explanation: 'Valid PayNote',
    });

    const result = await validatePayNoteHandler(
      {
        body: {
          yamlContent: 'name: demo',
          formData: {
            fromAccount: '137',
            totalAmount: '100.00',
          },
        },
      } as any,
      { request: {} as any }
    );

    expect(getOpenAiValidationProvider).toHaveBeenCalled();
    expect(validationProvider.validate).toHaveBeenCalledWith({
      yamlContent: 'name: demo',
      formData: {
        fromAccount: '137',
        totalAmount: '100.00',
      },
    });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      validationScore: 8,
      explanation: 'Valid PayNote',
    });
    expect(verificationRepository.saveVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        blueId: 'blue-id-xyz',
        validationScore: 8,
        explanation: 'Valid PayNote',
        isSuccessful: true,
      })
    );
  });

  it('handles provider failures gracefully', async () => {
    validationProvider.validate.mockRejectedValue(new Error('boom'));

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

  it('sets TTL when validation is performed in test mode', async () => {
    hoistedDeps.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-123',
      isTest: true,
    });
    validationProvider.validate.mockResolvedValue({
      validationScore: 7,
      explanation: 'Looks okay',
    });

    vi.useFakeTimers();
    const fixedDate = new Date('2024-01-01T00:00:00.000Z');
    vi.setSystemTime(fixedDate);

    try {
      await validatePayNoteHandler(
        {
          body: {
            yamlContent: 'name: demo',
            formData: {},
          },
        } as any,
        { request: {} as any }
      );
    } finally {
      vi.useRealTimers();
    }

    expect(validationProvider.validate).toHaveBeenCalled();
    const payload =
      verificationRepository.saveVerification.mock.calls[0]?.[0] ?? {};
    const expectedTtl = Math.floor(fixedDate.getTime() / 1000) + 24 * 60 * 60;
    expect(payload.ttl).toBe(expectedTtl);
    expect(payload.isSuccessful).toBe(true);
  });
});
