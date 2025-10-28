import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeBootstrapPayNote } from '../bootstrapPayNote';
import type { PaynoteDependencies } from '../../dependencies';

const hoistedMocks = vi.hoisted(() => ({
  bootstrapPayNoteMock: vi.fn(),
  extractAuthInfoMock: vi.fn(),
}));

vi.mock('../../../auth/middleware', () => ({
  extractAuthInfo: hoistedMocks.extractAuthInfoMock,
}));

vi.mock('@demo-bank-app/paynotes', () => ({
  bootstrapPayNote: hoistedMocks.bootstrapPayNoteMock,
}));

const createDependencies = (): PaynoteDependencies => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  } as any,
  getOpenAiApiKey: vi.fn(),
  getMyOsCredentials: vi.fn(),
  payNoteVerificationRepository: {} as any,
  bankingRepository: {} as any,
  holdRepository: {} as any,
  myOsClient: {} as any,
  bankingFacade: {} as any,
  blueIdCalculator: {
    fromYaml: vi.fn(),
    fromObject: vi.fn(),
    toReversedJson: vi.fn(),
  },
  clock: { now: () => new Date() },
  idGenerator: { generate: vi.fn().mockReturnValue('generated-id') },
});

describe('executeBootstrapPayNote', () => {
  const request = {
    body: {
      payNote: { name: 'Example' },
      formData: { fromAccount: '123' },
    },
  } as any;

  const context = { request: {} as any };

  beforeEach(() => {
    hoistedMocks.bootstrapPayNoteMock.mockReset();
    hoistedMocks.extractAuthInfoMock.mockReset();
    hoistedMocks.extractAuthInfoMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
    });
  });

  it('maps verification failures to 400 response', async () => {
    const dependencies = createDependencies();
    hoistedMocks.bootstrapPayNoteMock.mockResolvedValueOnce({
      type: 'verification-failed',
      verification: null,
      blueId: 'blue-id',
    });

    const response = await executeBootstrapPayNote({
      request,
      context,
      dependencies,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('PAYNOTE_NOT_VERIFIED');
    expect(dependencies.logger.error).toHaveBeenCalledWith(
      'PayNote bootstrap rejected due to missing verification',
      expect.objectContaining({
        userId: 'user-1',
        blueId: 'blue-id',
      })
    );
    expect(hoistedMocks.bootstrapPayNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        payNote: { name: 'Example' },
      }),
      expect.objectContaining({
        idGenerator: dependencies.idGenerator,
        blueIdCalculator: dependencies.blueIdCalculator,
      })
    );
  });

  it('returns success payload when use case succeeds', async () => {
    const dependencies = createDependencies();
    hoistedMocks.bootstrapPayNoteMock.mockResolvedValueOnce({
      type: 'success',
      response: { ok: true, status: 200, body: { documentId: 'doc-1' } },
      payNoteBankId: 'generated-id',
    });

    const response = await executeBootstrapPayNote({
      request,
      context,
      dependencies,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Bootstrap accepted' });
    expect(dependencies.logger.info).toHaveBeenCalledWith(
      'MyOS bootstrap response received',
      expect.objectContaining({
        status: 200,
        ok: true,
      })
    );
  });
});
