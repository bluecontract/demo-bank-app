import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapPayNote } from '../bootstrapPayNote';
import type {
  BlueIdCalculator,
  MyOsBootstrapResponse,
  MyOsClient,
  PayNoteVerificationRepository,
} from '../ports';

const createVerificationRepository = (
  verification: any = {
    userId: 'user-123',
    blueId: 'blue-id',
    validationScore: 8,
    explanation: 'ok',
    isSuccessful: true,
    validatedAt: '2024-01-01T00:00:00.000Z',
  }
): PayNoteVerificationRepository => ({
  getVerification: vi.fn().mockResolvedValue(verification),
  saveVerification: vi.fn(),
});

const createBlueIdCalculator = (): BlueIdCalculator => ({
  fromYaml: vi.fn(),
  fromObject: vi.fn(() => 'blue-id'),
  toReversedJson: vi.fn(),
});

const createMyOsClient = (
  response: MyOsBootstrapResponse = {
    ok: true,
    status: 200,
    body: { id: 'doc-1' },
  }
): MyOsClient => ({
  getCredentials: vi.fn().mockResolvedValue({
    apiKey: 'key',
    accountId: 'account-123',
    baseUrl: 'https://example.com',
  }),
  bootstrapDocument: vi.fn().mockResolvedValue(response),
  fetchEvent: vi.fn(),
});

const idGenerator = { generate: vi.fn(() => 'generated-id') };

describe('bootstrapPayNote', () => {
  let verificationRepository: PayNoteVerificationRepository;
  let calculator: BlueIdCalculator;
  let myOsClient: MyOsClient;

  beforeEach(() => {
    verificationRepository = createVerificationRepository();
    calculator = createBlueIdCalculator();
    myOsClient = createMyOsClient();
    idGenerator.generate.mockClear();
  });

  const deps = () => ({
    verificationRepository,
    myOsClient,
    idGenerator,
    blueIdCalculator: calculator,
    minimumSuccessfulScore: 7,
  });

  it('returns verification-failed when verification is missing', async () => {
    verificationRepository.getVerification = vi.fn().mockResolvedValue(null);

    const result = await bootstrapPayNote(
      {
        userId: 'user-123',
        userEmail: 'user@example.com',
        payNote: {},
        formData: {},
      },
      deps()
    );

    expect(result).toEqual({
      type: 'verification-failed',
      verification: null,
      blueId: 'blue-id',
    });
  });

  it('returns verification-failed when score below threshold', async () => {
    verificationRepository.getVerification = vi.fn().mockResolvedValue({
      userId: 'user-123',
      blueId: 'blue-id',
      validationScore: 5,
      explanation: 'nope',
      isSuccessful: true,
      validatedAt: '2024-01-01T00:00:00.000Z',
    });

    const result = await bootstrapPayNote(
      {
        userId: 'user-123',
        userEmail: 'user@example.com',
        payNote: {},
        formData: {},
      },
      deps()
    );

    expect(result.type).toBe('verification-failed');
  });

  it('returns missing-from-account when fromAccount is absent', async () => {
    const result = await bootstrapPayNote(
      {
        userId: 'user-123',
        userEmail: 'user@example.com',
        payNote: {},
        formData: {},
      },
      deps()
    );

    expect(result).toEqual({ type: 'missing-from-account' });
    expect(myOsClient.bootstrapDocument).not.toHaveBeenCalled();
  });

  it('invokes MyOS client and returns success when response ok', async () => {
    const payNote = {
      contracts: {
        payerChannel: { type: 'MyOS Timeline Channel' },
      },
    };

    const result = await bootstrapPayNote(
      {
        userId: 'user-123',
        userEmail: 'user@example.com',
        payNote,
        formData: {
          fromAccount: 'from-acc',
          toAccount: 'to-acc',
        },
      },
      deps()
    );

    expect(idGenerator.generate).toHaveBeenCalled();
    expect(myOsClient.getCredentials).toHaveBeenCalled();
    expect(myOsClient.bootstrapDocument).toHaveBeenCalledWith({
      credentials: {
        apiKey: 'key',
        accountId: 'account-123',
        baseUrl: 'https://example.com',
      },
      payload: {
        channelBindings: {
          payerChannel: { email: 'user@example.com' },
        },
        document: expect.objectContaining({
          payNoteBankId: { type: 'Text', value: 'generated-id' },
          payerAccountNumber: { type: 'Text', value: 'from-acc' },
          payeeAccountNumber: { type: 'Text', value: 'to-acc' },
        }),
      },
    });

    expect(result).toEqual({
      type: 'success',
      response: { ok: true, status: 200, body: { id: 'doc-1' } },
      payNoteBankId: 'generated-id',
    });
  });

  it('returns external-error when MyOS response not ok', async () => {
    myOsClient = createMyOsClient({
      ok: false,
      status: 500,
      body: { error: 'boom' },
    });

    const result = await bootstrapPayNote(
      {
        userId: 'user-123',
        userEmail: 'user@example.com',
        payNote: {},
        formData: {
          fromAccount: 'from-acc',
        },
      },
      {
        ...deps(),
        myOsClient,
      }
    );

    expect(result).toEqual({
      type: 'external-error',
      response: { ok: false, status: 500, body: { error: 'boom' } },
      payNoteBankId: 'generated-id',
    });
  });
});
