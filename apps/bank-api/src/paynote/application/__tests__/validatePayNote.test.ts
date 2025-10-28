import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeValidatePayNote } from '../validatePayNote';
import type { PaynoteDependencies } from '../../dependencies';

const hoistedMocks = vi.hoisted(() => ({
  validatePayNoteMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

vi.mock('../../../auth/middleware', () => ({
  extractAuthInfo: hoistedMocks.extractAuthInfoMock,
}));

vi.mock('@demo-bank-app/paynotes', () => ({
  validatePayNote: hoistedMocks.validatePayNoteMock,
}));

const createDependencies = (): PaynoteDependencies => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  } as any,
  getOpenAiApiKey: vi.fn().mockResolvedValue('api-key'),
  getMyOsCredentials: vi.fn(),
  payNoteVerificationRepository: {
    saveVerification: vi.fn(),
  } as any,
  bankingRepository: {} as any,
  holdRepository: {} as any,
  myOsClient: {} as any,
  bankingFacade: {} as any,
  blueIdCalculator: {
    fromYaml: vi.fn().mockReturnValue('blue-id-123'),
    fromObject: vi.fn(),
    toReversedJson: vi.fn(),
  },
  clock: { now: () => new Date('2024-01-01T00:00:00.000Z') },
  idGenerator: { generate: vi.fn() },
});

describe('executeValidatePayNote', () => {
  const baseRequest = {
    body: {
      yamlContent: 'name: PayNote',
      formData: {},
    },
  } as any;

  const context = { request: {} as any };

  beforeEach(() => {
    hoistedMocks.validatePayNoteMock.mockReset();
    hoistedMocks.extractAuthInfoMock.mockReset();
    hoistedMocks.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-123',
      isTest: false,
    });
  });

  it('returns validation error when YAML content is missing', async () => {
    const dependencies = createDependencies();
    const response = await executeValidatePayNote({
      request: {
        body: { yamlContent: '', formData: {} },
      } as any,
      context,
      dependencies,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(hoistedMocks.validatePayNoteMock).not.toHaveBeenCalled();
  });

  it('returns success response when use case succeeds', async () => {
    const dependencies = createDependencies();
    hoistedMocks.validatePayNoteMock.mockResolvedValueOnce({
      validationScore: 9,
      explanation: 'Looks good',
      blueId: 'blue-id-123',
      isSuccessful: true,
    });

    const response = await executeValidatePayNote({
      request: baseRequest,
      context,
      dependencies,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      validationScore: 9,
      explanation: 'Looks good',
    });
    expect(dependencies.logger.info).toHaveBeenCalledWith(
      'PayNote validated',
      expect.objectContaining({
        userId: 'user-123',
        validationScore: 9,
      })
    );
    expect(hoistedMocks.validatePayNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        yamlContent: 'name: PayNote',
        userId: 'user-123',
      }),
      expect.objectContaining({
        blueIdCalculator: dependencies.blueIdCalculator,
        clock: dependencies.clock,
      })
    );
  });

  it('returns problem response when use case throws', async () => {
    const dependencies = createDependencies();
    hoistedMocks.validatePayNoteMock.mockRejectedValueOnce(new Error('boom'));

    const response = await executeValidatePayNote({
      request: baseRequest,
      context,
      dependencies,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(dependencies.logger.error).toHaveBeenCalledWith(
      'PayNote validation failed',
      expect.objectContaining({ userId: 'user-123' })
    );
  });
});
