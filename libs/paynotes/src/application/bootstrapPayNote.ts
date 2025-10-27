import type {
  BlueIdCalculator,
  IdGeneratorPort,
  MyOsBootstrapResponse,
  MyOsClient,
  PayNoteVerificationRecord,
  PayNoteVerificationRepository,
} from './ports';

export interface BootstrapPayNoteInput {
  userId: string;
  userEmail: string;
  payNote: Record<string, any>;
  formData: {
    fromAccount?: string;
    toAccount?: string;
  };
}

export interface BootstrapPayNoteDependencies {
  verificationRepository: PayNoteVerificationRepository;
  myOsClient: MyOsClient;
  idGenerator: IdGeneratorPort;
  blueIdCalculator: BlueIdCalculator;
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
      payNoteBankId: string;
    }
  | {
      type: 'success';
      response: MyOsBootstrapResponse;
      payNoteBankId: string;
    };

const buildChannelBindings = ({
  payNote,
  userEmail,
  myOsAccountId,
}: {
  payNote: Record<string, any>;
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
    if (value?.type === 'MyOS Timeline Channel') {
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

  const payNoteBankId = deps.idGenerator.generate();

  input.payNote.payNoteBankId = {
    type: 'Text',
    value: payNoteBankId,
  };

  if (input.formData.fromAccount) {
    if (!input.payNote.payerAccountNumber) {
      input.payNote.payerAccountNumber = {};
    }
    input.payNote.payerAccountNumber.type = 'Text';
    input.payNote.payerAccountNumber.value = input.formData.fromAccount;
  } else {
    return {
      type: 'missing-from-account',
    };
  }

  if (input.formData.toAccount) {
    if (!input.payNote.payeeAccountNumber) {
      input.payNote.payeeAccountNumber = {};
    }
    input.payNote.payeeAccountNumber.type = 'Text';
    input.payNote.payeeAccountNumber.value = input.formData.toAccount;
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
      payNoteBankId,
    };
  }

  return {
    type: 'success',
    response,
    payNoteBankId,
  };
};
