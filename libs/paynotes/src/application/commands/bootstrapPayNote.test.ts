import { describe, it, expect, vi } from 'vitest';
import { bootstrapPayNote } from './bootstrapPayNote';
import type {
  PayNoteVerificationRepository,
  MyOsClient,
  BlueIdCalculator,
  MyOsFetchEventResult,
  PayNoteBootstrapRepository,
  ClockPort,
} from '../ports';

const createVerificationRepository = (): PayNoteVerificationRepository => ({
  getVerification: vi.fn(),
  saveVerification: vi.fn(),
});

const createMyOsClient = (): MyOsClient => {
  const fetchEvent = vi.fn<MyOsClient['fetchEvent']>().mockResolvedValue({
    kind: 'success',
    payload: {},
  } as MyOsFetchEventResult);

  return {
    getCredentials: vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      accountId: 'account-id',
      baseUrl: 'https://api.example.com',
    }),
    bootstrapDocument: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { sessionId: 'bootstrap-1' },
    }),
    runDocumentOperation: vi.fn(),
    fetchEvent,
    fetchDocument: vi.fn(),
  } satisfies MyOsClient;
};

const createBlueIdCalculator = (): BlueIdCalculator => ({
  fromObject: vi.fn().mockReturnValue('blue-id'),
  fromYaml: vi.fn().mockReturnValue('blue-id'),
  toReversedJson: vi.fn((value: unknown) => value),
});

const createBootstrapRepository = (): PayNoteBootstrapRepository => ({
  getBootstrapBySessionId: vi.fn(),
  saveBootstrap: vi.fn(),
});

const createClock = (): ClockPort => ({
  now: () => new Date('2024-01-01T00:00:00.000Z'),
});

describe('bootstrapPayNote', () => {
  it('returns success when verification exists and stores bootstrap mapping', async () => {
    const verificationRepository = createVerificationRepository();
    vi.mocked(verificationRepository.getVerification).mockResolvedValue({
      userId: 'user-123',
      blueId: 'blue-id',
      validationScore: 8,
      explanation: 'Looks good',
      isSuccessful: true,
      validatedAt: new Date().toISOString(),
    });

    const payNoteBootstrapRepository = createBootstrapRepository();

    const result = await bootstrapPayNote(
      {
        userId: 'user-123',
        userEmail: 'user@example.com',
        formData: { fromAccount: '123', toAccount: '456' },
        payNote: { name: 'Test' },
      },
      {
        verificationRepository,
        myOsClient: createMyOsClient(),
        blueIdCalculator: createBlueIdCalculator(),
        payNoteBootstrapRepository,
        clock: createClock(),
        minimumSuccessfulScore: 7,
      }
    );

    expect(result.type).toBe('success');
    expect(payNoteBootstrapRepository.saveBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapSessionId: 'bootstrap-1',
        accountNumber: '123',
      })
    );
  });

  it('returns verification-failed when no verification', async () => {
    const verificationRepository = createVerificationRepository();
    vi.mocked(verificationRepository.getVerification).mockResolvedValue(null);

    const result = await bootstrapPayNote(
      {
        userId: 'user-123',
        userEmail: 'user@example.com',
        formData: { fromAccount: '123' },
        payNote: { name: 'Test' },
      },
      {
        verificationRepository,
        myOsClient: createMyOsClient(),
        blueIdCalculator: createBlueIdCalculator(),
        payNoteBootstrapRepository: createBootstrapRepository(),
        clock: createClock(),
        minimumSuccessfulScore: 7,
      }
    );

    expect(result.type).toBe('verification-failed');
  });
});
