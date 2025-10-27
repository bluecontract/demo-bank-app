import type {
  BankingFacade,
  BlueIdCalculator,
  ClockPort,
  LogEntry,
  MyOsClient,
} from './ports';

export interface GetPayNoteDetailsInput {
  accountNumber: string;
  myOsEventId: string;
  userId: string;
}

export interface GetPayNoteDetailsDependencies {
  bankingFacade: BankingFacade;
  myOsClient: MyOsClient;
  blueIdCalculator: BlueIdCalculator;
  clock: ClockPort;
}

interface AccountNotFoundResult {
  type: 'account-not-found';
  logs: LogEntry[];
}

interface EventNotFoundResult {
  type: 'event-not-found';
  logs: LogEntry[];
}

interface ExternalErrorResult {
  type: 'external-error';
  logs: LogEntry[];
  detail?: string;
  status?: number;
}

interface GetPayNoteDetailsSuccess {
  type: 'success';
  logs: LogEntry[];
  detail: {
    myosEventId: string;
    document?: unknown;
    transactionRequest?: unknown;
    triggerEvent: unknown;
    fetchedAt: string;
  };
}

export type GetPayNoteDetailsResult =
  | AccountNotFoundResult
  | EventNotFoundResult
  | ExternalErrorResult
  | GetPayNoteDetailsSuccess;

const log = (
  logs: LogEntry[],
  level: LogEntry['level'],
  message: string,
  context?: Record<string, unknown>
) => {
  logs.push({ level, message, context });
};

export const getPayNoteDetails = async (
  input: GetPayNoteDetailsInput,
  deps: GetPayNoteDetailsDependencies
): Promise<GetPayNoteDetailsResult> => {
  const logs: LogEntry[] = [];

  const account = await deps.bankingFacade.getAccountForUser(
    input.accountNumber,
    input.userId
  );

  if (!account) {
    return { type: 'account-not-found', logs };
  }

  const eventResult = await deps.myOsClient.fetchEvent(input.myOsEventId);

  if (eventResult.kind === 'not-found') {
    log(logs, 'warn', 'PayNote event not found in MyOS', {
      accountNumber: input.accountNumber,
      myOsEventId: input.myOsEventId,
    });
    return { type: 'event-not-found', logs };
  }

  if (eventResult.kind === 'http-error') {
    log(logs, 'error', 'Failed to retrieve PayNote event from MyOS', {
      accountNumber: input.accountNumber,
      myOsEventId: input.myOsEventId,
      myOsStatus: eventResult.status,
      statusText: eventResult.statusText,
    });
    return {
      type: 'external-error',
      logs,
      status: eventResult.status,
      detail: eventResult.detail,
    };
  }

  if (eventResult.kind === 'parse-error') {
    log(logs, 'error', 'Failed to retrieve PayNote event from MyOS', {
      accountNumber: input.accountNumber,
      myOsEventId: input.myOsEventId,
      myOsStatus: eventResult.status,
      error:
        eventResult.error instanceof Error
          ? eventResult.error.message
          : String(eventResult.error),
    });
    return {
      type: 'external-error',
      logs,
      status: eventResult.status,
      detail:
        eventResult.error instanceof Error
          ? eventResult.error.message
          : String(eventResult.error),
    };
  }

  if (eventResult.kind === 'network-error') {
    log(logs, 'error', 'Failed to retrieve PayNote event from MyOS', {
      accountNumber: input.accountNumber,
      myOsEventId: input.myOsEventId,
      error:
        eventResult.error instanceof Error
          ? eventResult.error.message
          : String(eventResult.error),
    });
    return {
      type: 'external-error',
      logs,
      detail:
        eventResult.error instanceof Error
          ? eventResult.error.message
          : String(eventResult.error),
    };
  }

  const payload = eventResult.payload as {
    object?: {
      document?: any;
      emitted?: unknown;
      triggeredBy?: unknown;
    };
  };

  const payNoteObject = payload?.object ?? {};
  const document = payNoteObject?.document;

  const payerAccountFromDocument =
    typeof document?.payerAccountNumber?.value === 'string'
      ? document.payerAccountNumber.value
      : undefined;

  if (payerAccountFromDocument !== account.accountNumber) {
    log(logs, 'warn', 'PayNote event document does not match account owner', {
      accountNumber: input.accountNumber,
      myOsEventId: input.myOsEventId,
      payerAccountFromDocument,
    });
    return { type: 'event-not-found', logs };
  }

  const fetchedAt = deps.clock.now().toISOString();

  const detail = {
    myosEventId: input.myOsEventId,
    document: document
      ? deps.blueIdCalculator.toReversedJson(document)
      : undefined,
    transactionRequest:
      deps.blueIdCalculator.toReversedJson(payNoteObject.emitted) ?? undefined,
    triggerEvent:
      deps.blueIdCalculator.toReversedJson(payNoteObject.triggeredBy) ?? null,
    fetchedAt,
  };

  log(logs, 'info', 'PayNote details fetched successfully', {
    accountNumber: input.accountNumber,
    myOsEventId: input.myOsEventId,
    hasDocument: Boolean(detail.document),
    transactionRequestCount: Array.isArray(detail.transactionRequest)
      ? detail.transactionRequest.length
      : detail.transactionRequest
      ? 1
      : 0,
    hasTriggerEvent: Boolean(detail.triggerEvent),
  });

  return {
    type: 'success',
    logs,
    detail,
  };
};
