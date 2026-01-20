import type {
  BlueIdCalculator,
  ClockPort,
  MyOsBootstrapResponse,
  MyOsClient,
  PayNoteBootstrapRepository,
  PayNoteVerificationRecord,
  PayNoteVerificationRepository,
} from '../ports';

export interface BootstrapPayNoteInput {
  userId: string;
  userEmail: string;
  payNote: Record<string, unknown>;
  formData: {
    fromAccount?: string;
    toAccount?: string;
  };
}

export interface BootstrapPayNoteDependencies {
  verificationRepository: PayNoteVerificationRepository;
  myOsClient: MyOsClient;
  blueIdCalculator: BlueIdCalculator;
  payNoteBootstrapRepository: PayNoteBootstrapRepository;
  clock: ClockPort;
  minimumSuccessfulScore: number;
}

export type BootstrapPayNoteResult =
  | {
      type: 'verification-failed';
      verification: PayNoteVerificationRecord | null;
      blueId: string;
    }
  | {
      type: 'missing-from-account';
    }
  | {
      type: 'external-error';
      response: MyOsBootstrapResponse;
    }
  | {
      type: 'success';
      response: MyOsBootstrapResponse;
      bootstrapSessionId?: string;
    };

const buildChannelBindings = ({
  payNote,
  userEmail,
  myOsAccountId,
}: {
  payNote: Record<string, unknown>;
  userEmail: string;
  myOsAccountId: string;
}): Record<string, { email?: string; accountId?: string }> => {
  const contracts = (payNote.contracts ?? {}) as Record<
    string,
    { type?: string; email?: string; accountId?: string }
  >;

  const channelBindings: Record<
    string,
    { email?: string; accountId?: string }
  > = {};

  if (contracts.payerChannel) {
    channelBindings.payerChannel = { email: userEmail };
  }

  Object.entries(contracts).forEach(([key, value]) => {
    if (value?.type === 'MyOS/MyOS Timeline Channel') {
      if (value.email) {
        channelBindings[key] = { email: value.email };
      } else if (value.accountId) {
        channelBindings[key] = { accountId: value.accountId };
      } else if (!channelBindings[key]) {
        channelBindings[key] = { accountId: myOsAccountId };
      }
    }
  });

  return channelBindings;
};

const extractBootstrapSessionId = (
  response: MyOsBootstrapResponse
): string | undefined => {
  const body = response.body as { sessionId?: unknown } | undefined;
  return typeof body?.sessionId === 'string' ? body.sessionId : undefined;
};

export const bootstrapPayNote = async (
  input: BootstrapPayNoteInput,
  deps: BootstrapPayNoteDependencies
): Promise<BootstrapPayNoteResult> => {
  const blueId = deps.blueIdCalculator.fromObject(
    input.payNote as Record<string, unknown>
  );

  const verification = await deps.verificationRepository.getVerification({
    userId: input.userId,
    blueId,
  });

  if (
    !verification ||
    !verification.isSuccessful ||
    verification.validationScore < deps.minimumSuccessfulScore
  ) {
    return {
      type: 'verification-failed',
      verification,
      blueId,
    };
  }

  const payerAccountNumber = input.formData.fromAccount;
  if (!payerAccountNumber) {
    return {
      type: 'missing-from-account',
    };
  }

  const credentials = await deps.myOsClient.getCredentials();

  const channelBindings = buildChannelBindings({
    payNote: input.payNote,
    userEmail: input.userEmail,
    myOsAccountId: credentials.accountId,
  });

  const response = await deps.myOsClient.bootstrapDocument({
    credentials,
    payload: {
      channelBindings,
      document: input.payNote,
    },
  });

  if (!response.ok) {
    return {
      type: 'external-error',
      response,
    };
  }

  const bootstrapSessionId = extractBootstrapSessionId(response);

  if (bootstrapSessionId) {
    await deps.payNoteBootstrapRepository.saveBootstrap({
      bootstrapSessionId,
      userId: input.userId,
      accountNumber: payerAccountNumber,
      payerAccountNumber,
      payeeAccountNumber: input.formData.toAccount,
      createdAt: deps.clock.now().toISOString(),
    });
  }

  return {
    type: 'success',
    response,
    bootstrapSessionId,
  };
};
