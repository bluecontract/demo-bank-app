import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePayNote } from '../validatePayNote';
import type {
  BlueIdCalculator,
  PayNoteValidationProvider,
  PayNoteVerificationRepository,
} from '../ports';

const fixedDate = new Date('2024-01-01T00:00:00.000Z');

const createClock = () => ({
  now: vi.fn(() => fixedDate),
});

const createBlueIdCalculator = (): BlueIdCalculator => ({
  fromYaml: vi.fn(() => 'blue-id-from-yaml'),
  fromObject: vi.fn(),
  toReversedJson: vi.fn(),
});

const createValidationProvider = (
  result = { validationScore: 9, explanation: 'Looks valid' }
): PayNoteValidationProvider => ({
  validate: vi.fn().mockResolvedValue(result),
});

const createVerificationRepository = (): PayNoteVerificationRepository => ({
  saveVerification: vi.fn().mockResolvedValue(undefined),
  getVerification: vi.fn(),
});

describe('validatePayNote', () => {
  const config = {
    minimumSuccessfulScore: 7,
    testVerificationTtlSeconds: 60,
  };

  let validationProvider: PayNoteValidationProvider;
  let verificationRepository: PayNoteVerificationRepository;
  let calculator: BlueIdCalculator;
  let clock: ReturnType<typeof createClock>;

  beforeEach(() => {
    validationProvider = createValidationProvider();
    verificationRepository = createVerificationRepository();
    calculator = createBlueIdCalculator();
    clock = createClock();
  });

  it('saves verification result and returns summary', async () => {
    const result = await validatePayNote(
      {
        userId: 'user-123',
        yamlContent: 'content',
        formData: {},
      },
      {
        verificationRepository,
        validationProvider,
        blueIdCalculator: calculator,
        clock,
        config,
      }
    );

    expect(validationProvider.validate).toHaveBeenCalledWith({
      yamlContent: 'content',
      formData: {},
    });

    expect(verificationRepository.saveVerification).toHaveBeenCalledWith({
      userId: 'user-123',
      blueId: 'blue-id-from-yaml',
      validationScore: 9,
      explanation: 'Looks valid',
      isSuccessful: true,
      validatedAt: fixedDate.toISOString(),
      ttl: undefined,
    });

    expect(result).toEqual({
      validationScore: 9,
      explanation: 'Looks valid',
      blueId: 'blue-id-from-yaml',
      isSuccessful: true,
      validatedAt: fixedDate.toISOString(),
      ttl: undefined,
    });
  });

  it('marks validation as unsuccessful when score below minimum', async () => {
    validationProvider = createValidationProvider({
      validationScore: 5,
      explanation: 'Too low',
    });

    const result = await validatePayNote(
      {
        userId: 'user-123',
        yamlContent: 'content',
        formData: {},
      },
      {
        verificationRepository,
        validationProvider,
        blueIdCalculator: calculator,
        clock,
        config,
      }
    );

    expect(result.isSuccessful).toBe(false);
    expect(verificationRepository.saveVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        isSuccessful: false,
        validationScore: 5,
      })
    );
  });

  it('applies TTL when running in test mode', async () => {
    await validatePayNote(
      {
        userId: 'user-123',
        yamlContent: 'content',
        formData: {},
        isTestRun: true,
      },
      {
        verificationRepository,
        validationProvider,
        blueIdCalculator: calculator,
        clock,
        config,
      }
    );

    expect(verificationRepository.saveVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        ttl:
          Math.floor(fixedDate.getTime() / 1000) +
          config.testVerificationTtlSeconds,
      })
    );
  });

  it('propagates validation provider errors', async () => {
    validationProvider.validate = vi
      .fn()
      .mockRejectedValue(new Error('provider failed'));

    await expect(
      validatePayNote(
        {
          userId: 'user-123',
          yamlContent: 'content',
          formData: {},
        },
        {
          verificationRepository,
          validationProvider,
          blueIdCalculator: calculator,
          clock,
          config,
        }
      )
    ).rejects.toThrow('provider failed');
  });
});
