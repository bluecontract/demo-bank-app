import type {
  BlueIdCalculator,
  ClockPort,
  PayNoteValidationFormData,
  PayNoteValidationProvider,
  PayNoteVerificationRepository,
} from './ports';

export interface ValidatePayNoteInput {
  userId: string;
  yamlContent: string;
  formData: PayNoteValidationFormData;
  isTestRun?: boolean;
}

export interface ValidatePayNoteConfig {
  minimumSuccessfulScore: number;
  testVerificationTtlSeconds: number;
}

export interface ValidatePayNoteDependencies {
  verificationRepository: PayNoteVerificationRepository;
  validationProvider: PayNoteValidationProvider;
  blueIdCalculator: BlueIdCalculator;
  clock: ClockPort;
  config: ValidatePayNoteConfig;
}

export interface ValidatePayNoteResult {
  validationScore: number;
  explanation: string;
  blueId: string;
  isSuccessful: boolean;
  validatedAt: string;
  ttl?: number;
}

export const validatePayNote = async (
  input: ValidatePayNoteInput,
  deps: ValidatePayNoteDependencies
): Promise<ValidatePayNoteResult> => {
  const blueId = deps.blueIdCalculator.fromYaml(input.yamlContent);

  const validation = await deps.validationProvider.validate({
    yamlContent: input.yamlContent,
    formData: input.formData,
  });

  const now = deps.clock.now();
  const validatedAt = now.toISOString();
  const isSuccessful =
    validation.validationScore >= deps.config.minimumSuccessfulScore;

  const ttl = input.isTestRun
    ? Math.floor(now.getTime() / 1000) + deps.config.testVerificationTtlSeconds
    : undefined;

  await deps.verificationRepository.saveVerification({
    userId: input.userId,
    blueId,
    validationScore: validation.validationScore,
    explanation: validation.explanation,
    isSuccessful,
    validatedAt,
    ttl,
  });

  return {
    validationScore: validation.validationScore,
    explanation: validation.explanation,
    blueId,
    isSuccessful,
    validatedAt,
    ttl,
  };
};
