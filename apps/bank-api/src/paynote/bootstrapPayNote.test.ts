import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapPayNoteHandler } from './bootstrapPayNote';

const hoistedDeps = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

const hoistedBlueId = vi.hoisted(() => ({
  calculateBlueIdFromObjectMock: vi.fn().mockReturnValue('blue-id-123'),
}));

const hoistedAdapters = vi.hoisted(() => ({
  bootstrapDocumentMock: vi.fn(),
  bootstrapResponse: { ok: true, status: 200, body: { documentId: 'doc-123' } },
  idGeneratorMock: vi.fn().mockReturnValue('generated-id'),
}));

vi.mock('./dependencies', () => ({
  getDependencies: hoistedDeps.getDependenciesMock,
}));

vi.mock('./blueId', () => ({
  calculateBlueIdFromObject: hoistedBlueId.calculateBlueIdFromObjectMock,
}));

vi.mock('./useCaseAdapters', () => ({
  createBlueIdCalculator: () => ({
    fromYaml: vi.fn(),
    fromObject: hoistedBlueId.calculateBlueIdFromObjectMock,
    toReversedJson: vi.fn(),
  }),
  createIdGenerator: () => ({
    generate: hoistedAdapters.idGeneratorMock,
  }),
  createMyOsClient: (resolveCredentials: () => Promise<any>) => ({
    getCredentials: resolveCredentials,
    bootstrapDocument: async (input: any) => {
      hoistedAdapters.bootstrapDocumentMock(input);
      return hoistedAdapters.bootstrapResponse;
    },
    fetchEvent: vi.fn(),
  }),
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoistedDeps.extractAuthInfoMock,
}));

describe('bootstrapPayNoteHandler', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const verificationRepository = {
    getVerification: vi.fn(),
  };

  const createPayNote = () => ({
    name: 'Test PayNote',
    payerAccountNumber: {},
    payeeAccountNumber: {},
    contracts: {
      payerChannel: { type: 'MyOS Timeline Channel' },
      payeeChannel: {
        type: 'MyOS Timeline Channel',
        email: 'payee@example.com',
      },
      guarantorChannel: { type: 'MyOS Timeline Channel' },
    },
  });

  beforeEach(() => {
    hoistedDeps.getDependenciesMock.mockReset();
    hoistedDeps.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
    verificationRepository.getVerification.mockReset();
    hoistedBlueId.calculateBlueIdFromObjectMock.mockReturnValue('blue-id-123');
    hoistedAdapters.bootstrapDocumentMock.mockReset();
    hoistedAdapters.bootstrapResponse = {
      ok: true,
      status: 200,
      body: { documentId: 'doc-123' },
    };
    hoistedAdapters.idGeneratorMock.mockReturnValue('generated-id');

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      getMyOsCredentials: vi.fn().mockResolvedValue({
        apiKey: 'myos-api-key',
        accountId: 'myos-account',
        baseUrl: 'https://test-api.myos.blue',
      }),
      payNoteVerificationRepository: verificationRepository,
    });

    hoistedDeps.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-123',
      userEmail: 'john.doe@example.com',
      isTest: false,
    });

    verificationRepository.getVerification.mockResolvedValue({
      userId: 'user-123',
      blueId: 'blue-id-123',
      validationScore: 8,
      explanation: 'Valid PayNote',
      isSuccessful: true,
      validatedAt: new Date().toISOString(),
    });
  });

  it('returns success when paynote bootstrap is accepted', async () => {
    const result = await bootstrapPayNoteHandler(
      {
        body: {
          payNote: createPayNote(),
          formData: { fromAccount: '137' },
        },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ message: 'Bootstrap accepted' });
    expect(logger.info).toHaveBeenCalledWith(
      'Received PayNote bootstrap request',
      expect.objectContaining({
        userId: 'user-123',
        userEmail: 'john.doe@example.com',
      })
    );

    expect(hoistedAdapters.bootstrapDocumentMock).toHaveBeenCalledWith({
      credentials: {
        apiKey: 'myos-api-key',
        accountId: 'myos-account',
        baseUrl: 'https://test-api.myos.blue',
      },
      payload: expect.objectContaining({
        document: expect.objectContaining({
          payNoteBankId: { type: 'Text', value: 'generated-id' },
          payerAccountNumber: { type: 'Text', value: '137' },
        }),
        channelBindings: expect.objectContaining({
          payerChannel: { email: 'john.doe@example.com' },
          guarantorChannel: { accountId: 'myos-account' },
        }),
      }),
    });

    expect(verificationRepository.getVerification).toHaveBeenCalledWith({
      userId: 'user-123',
      blueId: 'blue-id-123',
    });
  });

  it('rejects when no successful verification exists', async () => {
    verificationRepository.getVerification.mockResolvedValue(null);

    const result = await bootstrapPayNoteHandler(
      {
        body: {
          payNote: createPayNote(),
          formData: { fromAccount: '137' },
        },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('PAYNOTE_NOT_VERIFIED');
    expect(hoistedAdapters.bootstrapDocumentMock).not.toHaveBeenCalled();
  });

  it('rejects when verification score is below threshold', async () => {
    verificationRepository.getVerification.mockResolvedValue({
      userId: 'user-123',
      blueId: 'blue-id-123',
      validationScore: 3,
      explanation: 'Too low',
      isSuccessful: false,
      validatedAt: new Date().toISOString(),
    });

    const result = await bootstrapPayNoteHandler(
      {
        body: {
          payNote: createPayNote(),
          formData: { fromAccount: '137' },
        },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('PAYNOTE_NOT_VERIFIED');
    expect(hoistedAdapters.bootstrapDocumentMock).not.toHaveBeenCalled();
  });

  it('returns validation error when dependencies fail', async () => {
    hoistedDeps.extractAuthInfoMock.mockRejectedValue(new Error('no user'));

    const result = await bootstrapPayNoteHandler(
      {
        body: { payNote: {}, formData: { fromAccount: '137' } },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('VALIDATION_ERROR');
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns problem response when MyOS bootstrap fails', async () => {
    hoistedAdapters.bootstrapResponse = {
      ok: false,
      status: 500,
      body: { message: 'boom' },
    };

    const result = await bootstrapPayNoteHandler(
      {
        body: {
          payNote: createPayNote(),
          formData: { fromAccount: '137' },
        },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('EXTERNAL_SERVICE_ERROR');
    expect(logger.error).toHaveBeenCalledWith(
      'MyOS bootstrap request failed',
      expect.objectContaining({ status: 500 })
    );
  });
});
