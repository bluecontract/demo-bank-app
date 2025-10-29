import { describe, it, expect, vi } from 'vitest';
import { validatePayNote } from './validatePayNote';
import type {
  PayNoteVerificationRepository,
  PayNoteValidationProvider,
  BlueIdCalculator,
  ClockPort,
} from '../ports';

const createVerificationRepository = () => ({
  saveVerification: vi.fn().mockResolvedValue(undefined),
  getVerification: vi.fn().mockResolvedValue(null),
});

const createValidationProvider = () => ({
  validate: vi.fn().mockResolvedValue({
    validationScore: 8,
    explanation: 'Looks good',
  }),
});

const createBlueIdCalculator = () => ({
  fromYaml: vi.fn().mockReturnValue('blue-id'),
  fromObject: vi.fn(),
  toReversedJson: vi.fn(),
});

const createClock = () => ({
  now: () => new Date('2024-01-01T00:00:00.000Z'),
});

describe('validatePayNote', () => {
  it('stores verification when validation succeeds', async () => {
    const verificationRepository = createVerificationRepository();
    const validationProvider = createValidationProvider();

    const result = await validatePayNote(
      {
        userId: 'user-123',
        yamlContent: 'content',
        formData: {},
      },
      {
        verificationRepository:
          verificationRepository as PayNoteVerificationRepository,
        validationProvider: validationProvider as PayNoteValidationProvider,
        blueIdCalculator: createBlueIdCalculator() as BlueIdCalculator,
        clock: createClock() as ClockPort,
        config: {
          minimumSuccessfulScore: 7,
          testVerificationTtlSeconds: 60,
        },
      }
    );

    expect(result.isSuccessful).toBe(true);
    expect(result.validationScore).toBe(8);
    expect(verificationRepository.saveVerification).toHaveBeenCalled();
  });

  it('includes TTL when test run', async () => {
    const verificationRepository = createVerificationRepository();
    const validationProvider = createValidationProvider();

    const result = await validatePayNote(
      {
        userId: 'user-123',
        yamlContent: 'content',
        formData: {},
        isTestRun: true,
      },
      {
        verificationRepository:
          verificationRepository as PayNoteVerificationRepository,
        validationProvider: validationProvider as PayNoteValidationProvider,
        blueIdCalculator: createBlueIdCalculator() as BlueIdCalculator,
        clock: createClock() as ClockPort,
        config: {
          minimumSuccessfulScore: 7,
          testVerificationTtlSeconds: 60,
        },
      }
    );

    expect(result.ttl).toBeGreaterThan(0);
  });
});
