import type {
  BankingFacade,
  BlueIdCalculator,
  ClockPort,
  LogEntry,
  PayNoteDeliveryRepository,
  PayNoteRepository,
} from '../ports';

export interface GetPayNoteDetailsInput {
  accountNumber: string;
  payNoteDocumentId: string;
  userId: string;
}

export interface GetPayNoteDetailsDependencies {
  bankingFacade: BankingFacade;
  payNoteRepository: PayNoteRepository;
  payNoteDeliveryRepository: PayNoteDeliveryRepository;
  blueIdCalculator: BlueIdCalculator;
  clock: ClockPort;
}

interface AccountNotFoundResult {
  type: 'account-not-found';
  logs: LogEntry[];
}

interface PayNoteNotFoundResult {
  type: 'paynote-not-found';
  logs: LogEntry[];
}

interface GetPayNoteDetailsSuccess {
  type: 'success';
  logs: LogEntry[];
  detail: {
    payNoteDocumentId: string;
    document?: unknown;
    transactionRequest?: unknown;
    triggerEvent: unknown;
    fetchedAt: string;
  };
}

export type GetPayNoteDetailsResult =
  | AccountNotFoundResult
  | PayNoteNotFoundResult
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

  const payNote = await deps.payNoteRepository.getPayNote(
    input.payNoteDocumentId
  );

  if (!payNote) {
    const delivery =
      await deps.payNoteDeliveryRepository.getDeliveryByDocumentId(
        input.payNoteDocumentId
      );
    if (
      delivery &&
      (!delivery.accountNumber ||
        delivery.accountNumber === account.accountNumber) &&
      (!delivery.userId || delivery.userId === input.userId)
    ) {
      const deliveryPayNote =
        delivery.payNoteDocument ??
        (
          delivery.deliveryDocument?.payNoteBootstrapRequest as
            | { document?: Record<string, unknown> }
            | undefined
        )?.document;
      const fetchedAt = deps.clock.now().toISOString();

      const detail = {
        payNoteDocumentId: input.payNoteDocumentId,
        document: deliveryPayNote
          ? deps.blueIdCalculator.toReversedJson(deliveryPayNote)
          : undefined,
        transactionRequest: null,
        triggerEvent: null,
        fetchedAt,
      };

      log(logs, 'info', 'PayNote details fetched from delivery record', {
        accountNumber: input.accountNumber,
        payNoteDocumentId: input.payNoteDocumentId,
        deliveryId: delivery.deliveryId,
        hasDocument: Boolean(detail.document),
      });

      return {
        type: 'success',
        logs,
        detail,
      };
    }

    log(logs, 'warn', 'PayNote record not found for account', {
      accountNumber: input.accountNumber,
      payNoteDocumentId: input.payNoteDocumentId,
    });
    return { type: 'paynote-not-found', logs };
  }

  if (
    (payNote.accountNumber &&
      payNote.accountNumber !== account.accountNumber) ||
    (payNote.userId && payNote.userId !== input.userId)
  ) {
    log(logs, 'warn', 'PayNote record does not match account owner', {
      accountNumber: input.accountNumber,
      payNoteDocumentId: input.payNoteDocumentId,
      payNoteAccountNumber: payNote.accountNumber,
      payNoteUserId: payNote.userId,
    });
    return { type: 'paynote-not-found', logs };
  }

  const fetchedAt = deps.clock.now().toISOString();

  const detail = {
    payNoteDocumentId: input.payNoteDocumentId,
    document: payNote.document
      ? deps.blueIdCalculator.toReversedJson(payNote.document)
      : undefined,
    transactionRequest: payNote.transactionRequest
      ? deps.blueIdCalculator.toReversedJson(payNote.transactionRequest)
      : undefined,
    triggerEvent: payNote.triggerEvent
      ? deps.blueIdCalculator.toReversedJson(payNote.triggerEvent)
      : null,
    fetchedAt,
  };

  log(logs, 'info', 'PayNote details fetched successfully', {
    accountNumber: input.accountNumber,
    payNoteDocumentId: input.payNoteDocumentId,
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
