import { describe, it, expect, vi } from 'vitest';
import { bootstrapPayNote } from './bootstrapPayNote';
import type {
  PayNoteVerificationRepository,
  MyOsClient,
  BlueIdCalculator,
  IdGeneratorPort,
  MyOsFetchEventResult,
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
      body: { id: 'doc-id' },
    }),
    fetchEvent,
  } satisfies MyOsClient;
};

const createBlueIdCalculator = (): BlueIdCalculator => ({
  fromObject: vi.fn().mockReturnValue('blue-id'),
  fromYaml: vi.fn().mockReturnValue('blue-id'),
  toReversedJson: vi.fn((value: unknown) => value),
});

const createIdGenerator = (): IdGeneratorPort => ({
  generate: vi.fn().mockReturnValue('generated-id'),
});

describe('bootstrapPayNote', () => {
  it('returns success when verification exists', async () => {
    const verificationRepository = createVerificationRepository();
    vi.mocked(verificationRepository.getVerification).mockResolvedValue({
      userId: 'user-123',
      blueId: 'blue-id',
      validationScore: 8,
      explanation: 'Looks good',
      isSuccessful: true,
      validatedAt: new Date().toISOString(),
    });

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
        idGenerator: createIdGenerator(),
        blueIdCalculator: createBlueIdCalculator(),
        minimumSuccessfulScore: 7,
      }
    );

    expect(result.type).toBe('success');
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
        idGenerator: createIdGenerator(),
        blueIdCalculator: createBlueIdCalculator(),
        minimumSuccessfulScore: 7,
      }
    );

    expect(result.type).toBe('verification-failed');
  });
});
