import { describe, it, expect, beforeEach, vi } from 'vitest';
import paynoteBlueIds from '@blue-repository/types/packages/paynote/blue-ids';
import { payNoteWebhookHandler } from './webhook';

const hoistedDeps = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
}));

const hoistedAdapters = vi.hoisted(() => ({
  fetchEventImpl: vi.fn(),
  getAccountByNumberImpl: vi.fn(),
  transferFundsMock: vi.fn(),
  reserveFundsMock: vi.fn(),
  captureHoldMock: vi.fn(),
}));

vi.mock('./dependencies', () => ({
  getDependencies: hoistedDeps.getDependenciesMock,
}));

describe('payNoteWebhookHandler', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  beforeEach(() => {
    hoistedDeps.getDependenciesMock.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
    logger.warn.mockReset();
    hoistedAdapters.fetchEventImpl.mockReset();
    hoistedAdapters.getAccountByNumberImpl.mockReset();
    hoistedAdapters.transferFundsMock.mockReset();
    hoistedAdapters.reserveFundsMock.mockReset();
    hoistedAdapters.captureHoldMock.mockReset();

    const myOsClient = {
      getCredentials: vi.fn(),
      bootstrapDocument: vi.fn(),
      fetchEvent: (eventId: string) => hoistedAdapters.fetchEventImpl(eventId),
    };

    const bankingFacade = {
      getAccountByNumber: (accountNumber: string) =>
        hoistedAdapters.getAccountByNumberImpl(accountNumber),
      getAccountForUser: vi.fn(),
      transferFunds: hoistedAdapters.transferFundsMock,
      reserveFunds: hoistedAdapters.reserveFundsMock,
      captureHold: hoistedAdapters.captureHoldMock,
    };

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      myOsClient,
      bankingFacade,
      bankingRepository: {} as any,
      holdRepository: {} as any,
      getMyOsCredentials: vi.fn(),
      getOpenAiApiKey: vi.fn(),
      payNoteVerificationRepository: {} as any,
      blueIdCalculator: {
        fromYaml: vi.fn(),
        fromObject: vi.fn(),
        toReversedJson: (value: unknown) => value,
      },
      clock: { now: () => new Date() },
      idGenerator: { generate: vi.fn() },
    });
  });

  it('handles capture, reserve, and transfer events', async () => {
    const payload = {
      id: 'event-123',
      object: {
        document: {
          payNoteBankId: { value: 'bank-note-789' },
          payerAccountNumber: { value: '9559276001' },
          payeeAccountNumber: { value: '9595234002' },
          amount: { total: { value: 16000 } },
          name: 'Invoice Q3',
        },
        emitted: [
          {
            type: {
              name: 'PayNote/Reserve Funds and Capture Immediately Requested',
              blueId:
                paynoteBlueIds[
                  'PayNote/Reserve Funds and Capture Immediately Requested'
                ],
            },
            amount: { value: 15000 },
          },
          {
            type: {
              name: 'PayNote/Capture Funds Requested',
              blueId: paynoteBlueIds['PayNote/Capture Funds Requested'],
            },
            amount: { value: 15000 },
          },
          {
            type: {
              name: 'PayNote/Reserve Funds Requested',
              blueId: paynoteBlueIds['PayNote/Reserve Funds Requested'],
            },
            amount: { value: 15000 },
          },
        ],
      },
    };

    hoistedAdapters.fetchEventImpl.mockResolvedValue({
      kind: 'success',
      payload,
    });
    hoistedAdapters.getAccountByNumberImpl.mockResolvedValue({
      id: 'acct-123',
      accountNumber: '9559276001',
      ownerUserId: 'user-456',
    });

    const response = await payNoteWebhookHandler({
      body: { id: 'event-123' },
    } as any);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(hoistedAdapters.transferFundsMock).toHaveBeenCalledWith({
      sourceAccountId: 'acct-123',
      destinationAccountNumber: '9595234002',
      amountMinor: 15000,
      description: 'Invoice Q3',
      userId: 'user-456',
      idempotencyKey: 'bank-note-789',
      payNoteEventId: 'event-123',
    });
    expect(hoistedAdapters.captureHoldMock).toHaveBeenCalledWith({
      holdId: 'bank-note-789',
      userId: 'user-456',
      idempotencyKey: 'bank-note-789',
      counterpartyAccountNumber: '9595234002',
      payNoteEventId: 'event-123',
    });
    expect(hoistedAdapters.reserveFundsMock).toHaveBeenCalledWith({
      holdId: 'bank-note-789',
      payerAccountNumber: '9559276001',
      amountMinor: 15000,
      counterpartyAccountNumber: '9595234002',
      userId: 'user-456',
      idempotencyKey: 'bank-note-789',
      payNoteEventId: 'event-123',
    });
    expect(logger.info).toHaveBeenCalledWith(
      'PayNote transfer triggered',
      expect.objectContaining({ transferAmountMinor: 15000 })
    );
  });

  it('logs ignored events when no capture action occurs', async () => {
    hoistedAdapters.fetchEventImpl.mockResolvedValue({
      kind: 'success',
      payload: {
        id: 'event-456',
        object: {
          document: {
            payNoteBankId: { value: 'bank-note-456' },
            payerAccountNumber: { value: '1111111111' },
            payeeAccountNumber: { value: '2222222222' },
          },
          emitted: [
            {
              type: {
                name: 'PayNote/PayNote Cancelled',
                blueId: paynoteBlueIds['PayNote/PayNote Cancelled'],
              },
            },
          ],
        },
      },
    });
    hoistedAdapters.getAccountByNumberImpl.mockResolvedValue({
      id: 'acct-123',
      accountNumber: '1111111111',
      ownerUserId: 'user-456',
    });

    await payNoteWebhookHandler({ body: { id: 'event-456' } } as any);

    expect(hoistedAdapters.transferFundsMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'PayNote webhook event ignored',
      expect.objectContaining({ eventType: 'PayNote/PayNote Cancelled' })
    );
  });

  it('returns early when payload lacks event id', async () => {
    const response = await payNoteWebhookHandler({ body: {} } as any);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      note: 'PayNote webhook received payload without valid id',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'PayNote webhook received payload without valid id',
      expect.any(Object)
    );
  });

  it('logs download errors when MyOS request fails', async () => {
    hoistedAdapters.fetchEventImpl.mockResolvedValue({
      kind: 'http-error',
      status: 503,
      statusText: 'Service Unavailable',
    });

    const response = await payNoteWebhookHandler({
      body: { id: 'event-999' },
    } as any);

    expect(response.body.note).toBe(
      'Failed to download PayNote event from MyOS'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to download PayNote event from MyOS',
      expect.objectContaining({ eventId: 'event-999', status: 503 })
    );
  });
});
