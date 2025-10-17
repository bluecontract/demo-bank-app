import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapPayNoteHandler } from './bootstrapPayNote';

const hoistedDeps = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

const hoistedBlueId = vi.hoisted(() => ({
  calculateBlueIdFromObjectMock: vi.fn().mockReturnValue('blue-id-123'),
}));

const createMockResponse = ({
  status,
  ok,
  body,
}: {
  status: number;
  ok: boolean;
  body?: unknown;
}) => {
  const cloneJson = vi.fn().mockResolvedValue(body);
  return {
    status,
    ok,
    json: vi.fn().mockResolvedValue(body),
    clone: () => ({
      json: cloneJson,
    }),
  };
};

vi.mock('./dependencies', () => ({
  getDependencies: hoistedDeps.getDependenciesMock,
}));

vi.mock('./blueId', () => ({
  calculateBlueIdFromObject: hoistedBlueId.calculateBlueIdFromObjectMock,
}));

vi.mock('../auth/middleware', () => ({
  extractAuthInfo: hoistedDeps.extractAuthInfoMock,
}));

describe('bootstrapPayNoteHandler', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const fetchMock = vi.fn();
  const verificationRepository = {
    getVerification: vi.fn(),
  };

  beforeEach(() => {
    hoistedDeps.getDependenciesMock.mockReset();
    hoistedDeps.extractAuthInfoMock.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
    fetchMock.mockReset();
    verificationRepository.getVerification.mockReset();
    hoistedBlueId.calculateBlueIdFromObjectMock.mockReturnValue('blue-id-123');

    global.fetch = fetchMock as unknown as typeof fetch;

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      getMyOsCredentials: vi.fn().mockResolvedValue({
        apiKey: 'myos-api-key',
        accountId: 'myos-account',
      }),
      payNoteVerificationRepository: verificationRepository,
    });

    hoistedDeps.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-123',
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

    fetchMock.mockResolvedValue(
      createMockResponse({
        status: 200,
        ok: true,
        body: { documentId: 'doc-123' },
      }) as any
    );
  });

  it('returns success when paynote bootstrap is accepted', async () => {
    const result = await bootstrapPayNoteHandler(
      {
        body: {
          payNote: { name: 'Test PayNote' },
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
        payNote: { name: 'Test PayNote' },
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.myos.blue/documents/bootstrap',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'myos-api-key',
        },
        body: JSON.stringify({
          channelBindings: {
            payerChannel: { email: 'payer@example.com' },
            payeeChannel: { email: 'payee@example.com' },
            guarantorChannel: { accountId: 'myos-account' },
          },
          document: {
            name: 'Test PayNote',
          },
        }),
      }
    );
    expect(verificationRepository.getVerification).toHaveBeenCalledWith({
      userId: 'user-123',
      blueId: 'blue-id-123',
    });
    expect(logger.info).toHaveBeenCalledWith(
      'MyOS bootstrap response received',
      expect.objectContaining({
        userId: 'user-123',
        status: 200,
        ok: true,
      })
    );
  });

  it('rejects when no successful verification exists', async () => {
    verificationRepository.getVerification.mockResolvedValue(null);

    const result = await bootstrapPayNoteHandler(
      {
        body: {
          payNote: { name: 'Test PayNote' },
        },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('PAYNOTE_NOT_VERIFIED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'PayNote bootstrap rejected due to missing verification',
      expect.objectContaining({
        userId: 'user-123',
        hasVerification: false,
      })
    );
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
          payNote: { name: 'Test PayNote' },
        },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('PAYNOTE_NOT_VERIFIED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns validation error when dependencies fail', async () => {
    hoistedDeps.extractAuthInfoMock.mockRejectedValue(new Error('no user'));

    const result = await bootstrapPayNoteHandler(
      {
        body: { payNote: {} },
      } as any,
      { request: {} as any }
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('VALIDATION_ERROR');
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns problem response when MyOS bootstrap fails', async () => {
    fetchMock.mockResolvedValueOnce(
      createMockResponse({
        status: 500,
        ok: false,
        body: { message: 'failure' },
      }) as any
    );

    const result = await bootstrapPayNoteHandler(
      {
        body: {
          payNote: { name: 'Test PayNote' },
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
