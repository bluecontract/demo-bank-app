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
    totalAmount?: string;
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
      preparedPayNote: Record<string, unknown>;
    };

const IMMEDIATE_CAPTURE_EVENT_TYPE =
  'PayNote/Reserve Funds and Capture Immediately Requested';

const normalizeString = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseMinorAmount = (value: string | undefined): number | undefined => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  const amountRegex = /^\d+(\.\d{1,2})?$/;
  if (!amountRegex.test(normalized)) {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.round(parsed * 100);
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const withImmediateCaptureAmount = (
  contracts: Record<string, unknown>,
  amountMinor: number
): Record<string, unknown> => {
  const bootstrap = asRecord(contracts.bootstrap);
  if (!bootstrap || !Array.isArray(bootstrap.steps)) {
    return contracts;
  }

  let updated = false;
  const steps = bootstrap.steps.map(step => {
    const stepRecord = asRecord(step);
    if (!stepRecord || stepRecord.type !== 'Conversation/Trigger Event') {
      return step;
    }

    const eventRecord = asRecord(stepRecord.event);
    if (!eventRecord || eventRecord.type !== IMMEDIATE_CAPTURE_EVENT_TYPE) {
      return step;
    }

    updated = true;
    return {
      ...stepRecord,
      event: {
        ...eventRecord,
        amount: amountMinor,
      },
    };
  });

  if (!updated) {
    return contracts;
  }

  return {
    ...contracts,
    bootstrap: {
      ...bootstrap,
      steps,
    },
  };
};

const preparePayNoteForBootstrap = (
  payNote: Record<string, unknown>,
  formData: BootstrapPayNoteInput['formData']
): Record<string, unknown> => {
  const payerAccountNumber = normalizeString(formData.fromAccount);
  const payeeAccountNumber = normalizeString(formData.toAccount);
  const amountMinor = parseMinorAmount(formData.totalAmount);

  const preparedPayNote: Record<string, unknown> = { ...payNote };

  if (payerAccountNumber) {
    preparedPayNote.payerAccountNumber = payerAccountNumber;
  }

  if (payeeAccountNumber) {
    preparedPayNote.payeeAccountNumber = payeeAccountNumber;
  }

  if (typeof amountMinor !== 'number') {
    return preparedPayNote;
  }

  const amountRecord = asRecord(preparedPayNote.amount);
  preparedPayNote.amount = {
    ...(amountRecord ?? {}),
    total: amountMinor,
  };

  const contracts = asRecord(preparedPayNote.contracts);
  if (contracts) {
    preparedPayNote.contracts = withImmediateCaptureAmount(
      contracts,
      amountMinor
    );
  }

  return preparedPayNote;
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
  const preparedPayNote = preparePayNoteForBootstrap(
    input.payNote,
    input.formData
  );

  const channelBindings = buildChannelBindings({
    payNote: preparedPayNote,
    userEmail: input.userEmail,
    myOsAccountId: credentials.accountId,
  });

  const response = await deps.myOsClient.bootstrapDocument({
    credentials,
    payload: {
      channelBindings,
      document: preparedPayNote,
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
    preparedPayNote,
  };
};
