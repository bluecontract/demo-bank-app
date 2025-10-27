import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebhookEvent } from '../handleWebhookEvent';
import type {
  BankingAccount,
  BankingFacade,
  MyOsClient,
  MyOsFetchEventResult,
} from '../ports';

const createBankingFacade = (): BankingFacade => ({
  getAccountByNumber: vi.fn().mockResolvedValue({
    id: 'acct-1',
    accountNumber: 'payer-123',
    ownerUserId: 'user-1',
  } as BankingAccount),
  getAccountForUser: vi.fn(),
  transferFunds: vi.fn().mockResolvedValue(undefined),
  reserveFunds: vi.fn().mockResolvedValue('hold-1'),
  captureHold: vi.fn().mockResolvedValue(undefined),
});

const createMyOsClient = (result: MyOsFetchEventResult): MyOsClient => ({
  getCredentials: vi.fn(),
  bootstrapDocument: vi.fn(),
  fetchEvent: vi.fn().mockResolvedValue(result),
});

const baseEventPayload = {
  object: {
    document: {
      payNoteBankId: { value: 'paynote-1' },
      payerAccountNumber: { value: 'payer-123' },
      payeeAccountNumber: { value: 'payee-456' },
      amount: { total: { value: 10_000 } },
      name: 'PayNote transfer',
    },
    emitted: [
      {
        type: { name: 'Reserve Funds and Capture Immediately Requested' },
        amount: { value: 10_000 },
      },
      {
        type: { name: 'Capture Funds Requested' },
        amount: { value: 10_000 },
      },
      {
        type: { name: 'Reserve Funds Requested' },
        amount: { value: 10_000 },
      },
      {
        type: { name: 'Ignored Event' },
      },
    ],
  },
};

describe('handleWebhookEvent', () => {
  let bankingFacade: BankingFacade;

  beforeEach(() => {
    bankingFacade = createBankingFacade();
  });

  it('maps MyOS fetch failures to error note', async () => {
    const myOsClient = createMyOsClient({
      kind: 'http-error',
      status: 500,
      statusText: 'Internal Error',
    });

    const result = await handleWebhookEvent(
      { eventId: 'evt-1' },
      {
        myOsClient,
        bankingFacade,
      }
    );

    expect(result.note).toBe('Failed to download PayNote event from MyOS');
    expect(result.logs).toEqual([
      {
        level: 'error',
        message: 'Failed to download PayNote event from MyOS',
        context: {
          eventId: 'evt-1',
          status: 500,
          statusText: 'Internal Error',
        },
      },
    ]);
    expect(bankingFacade.transferFunds).not.toHaveBeenCalled();
  });

  it('returns note when document missing', async () => {
    const myOsClient = createMyOsClient({
      kind: 'success',
      payload: { object: {} },
    });

    const result = await handleWebhookEvent(
      { eventId: 'evt-1' },
      { myOsClient, bankingFacade }
    );

    expect(result.note).toBe('PayNote event missing document payload');
    expect(result.logs[0]).toEqual({
      level: 'error',
      message: 'PayNote event missing document payload',
      context: { eventId: 'evt-1' },
    });
  });

  it('invokes banking facade for known events and logs actions', async () => {
    const myOsClient = createMyOsClient({
      kind: 'success',
      payload: baseEventPayload,
    });

    const result = await handleWebhookEvent(
      { eventId: 'evt-1' },
      { myOsClient, bankingFacade }
    );

    expect(result.note).toBe('');
    expect(bankingFacade.transferFunds).toHaveBeenCalledWith({
      sourceAccountId: 'acct-1',
      destinationAccountNumber: 'payee-456',
      amountMinor: 10_000,
      description: 'PayNote transfer',
      userId: 'user-1',
      idempotencyKey: 'paynote-1',
      payNoteEventId: 'evt-1',
    });
    expect(bankingFacade.captureHold).toHaveBeenCalledWith({
      holdId: 'paynote-1',
      userId: 'user-1',
      idempotencyKey: 'paynote-1',
      counterpartyAccountNumber: 'payee-456',
      payNoteEventId: 'evt-1',
    });
    expect(bankingFacade.reserveFunds).toHaveBeenCalledWith({
      holdId: 'paynote-1',
      payerAccountNumber: 'payer-123',
      amountMinor: 10_000,
      counterpartyAccountNumber: 'payee-456',
      userId: 'user-1',
      idempotencyKey: 'paynote-1',
      payNoteEventId: 'evt-1',
    });

    const logMessages = result.logs.map(entry => entry.message);
    expect(logMessages).toContain('Received PayNote webhook');
    expect(logMessages).toContain('PayNote transfer triggered');
    expect(logMessages).toContain('PayNote capture hold triggered');
    expect(logMessages).toContain('PayNote reserve funds triggered');
    expect(logMessages).toContain('PayNote webhook event ignored');
  });

  it('returns note when payer account cannot be found', async () => {
    bankingFacade.getAccountByNumber = vi.fn().mockResolvedValue(null);
    const myOsClient = createMyOsClient({
      kind: 'success',
      payload: baseEventPayload,
    });

    const result = await handleWebhookEvent(
      { eventId: 'evt-1' },
      { myOsClient, bankingFacade }
    );

    expect(result.note).toBe(
      'Unable to resolve payer account ID from number for PayNote transfer'
    );
    expect(bankingFacade.transferFunds).not.toHaveBeenCalled();
  });
});
