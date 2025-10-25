import { describe, it, expect, beforeEach, vi } from 'vitest';
import { payNoteWebhookHandler } from './webhook';

const hoisted = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  transferMoneyMock: vi.fn(),
}));

vi.mock('./dependencies', () => ({
  getDependencies: hoisted.getDependenciesMock,
}));

vi.mock('@demo-bank-app/banking', async () => {
  const actual = await vi.importActual<typeof import('@demo-bank-app/banking')>(
    '@demo-bank-app/banking'
  );
  return {
    ...actual,
    transferMoney: hoisted.transferMoneyMock,
  };
});

describe('payNoteWebhookHandler', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const getMyOsCredentials = vi.fn();
  const fetchMock = vi.fn();
  const bankingRepository = {
    getAccountIdByNumber: vi.fn(),
    getAccountById: vi.fn(),
  };

  beforeEach(() => {
    hoisted.getDependenciesMock.mockReset();
    logger.info.mockReset();
    logger.error.mockReset();
    getMyOsCredentials.mockReset();
    fetchMock.mockReset();
    hoisted.transferMoneyMock.mockReset();
    bankingRepository.getAccountIdByNumber.mockReset();
    bankingRepository.getAccountById.mockReset();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      getMyOsCredentials,
      bankingRepository,
    });

    getMyOsCredentials.mockResolvedValue({
      apiKey: 'api-key',
      baseUrl: 'https://test-api.myos.blue',
    });

    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('downloads event details, extracts transfer metadata and logs them', async () => {
    const payload = { id: 'event-123', type: 'DOCUMENT_CREATED' };
    const eventPayload = {
      id: 'event-123',
      object: {
        blueId: 'a56',
        document: {
          payerAccountNumber: { value: '9559276001' },
          payeeAccountNumber: { value: '9595234002' },
          amount: {
            total: { value: 16000 },
          },
          name: 'Invoice Q3',
          payNoteBankId: { value: 'bank-note-789' },
        },
        emitted: [
          { type: { name: 'Document Processing Initiated' } },
          {
            type: { name: 'Reserve Funds and Capture Immediately Requested' },
            amount: { value: 15000 },
          },
        ],
      },
    };

    bankingRepository.getAccountIdByNumber.mockResolvedValue('acct-123');
    bankingRepository.getAccountById.mockResolvedValue({
      id: 'acct-123',
      ownerUserId: 'user-456',
    });
    hoisted.transferMoneyMock.mockResolvedValue('txn-789');

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue(eventPayload),
    });

    const response = await payNoteWebhookHandler({
      body: payload,
    } as any);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-api.myos.blue/myos-events/event-123',
      {
        method: 'GET',
        headers: {
          Authorization: 'api-key',
          'Content-Type': 'application/json',
        },
      }
    );

    const receivedLog = logger.info.mock.calls.find(
      ([message]) => message === 'Received PayNote webhook'
    );
    expect(receivedLog).toBeTruthy();
    expect(receivedLog?.[1]).toEqual(
      expect.objectContaining({
        eventId: 'event-123',
        events: [
          { type: { name: 'Document Processing Initiated' } },
          {
            type: { name: 'Reserve Funds and Capture Immediately Requested' },
            amount: { value: 15000 },
          },
        ],
        payNoteBankId: 'bank-note-789',
        payerAccountNumber: '9559276001',
        payeeAccountNumber: '9595234002',
      })
    );

    const ignoredLog = logger.info.mock.calls.find(
      ([message]) => message === 'PayNote webhook event ignored'
    );
    expect(ignoredLog).toBeTruthy();
    expect(ignoredLog?.[1]).toEqual(
      expect.objectContaining({
        eventId: 'event-123',
        eventType: 'Document Processing Initiated',
        payerAccountNumber: '9559276001',
        payeeAccountNumber: '9595234002',
        transferAmountMinor: 0,
      })
    );

    expect(bankingRepository.getAccountIdByNumber).toHaveBeenCalledWith(
      '9559276001'
    );
    expect(bankingRepository.getAccountById).toHaveBeenCalledWith('acct-123');
    expect(hoisted.transferMoneyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        srcAccountId: 'acct-123',
        dstAccountNumber: '9595234002',
        ctx: {
          userId: 'user-456',
          idempotencyKey: 'bank-note-789',
        },
      }),
      expect.objectContaining({
        repository: bankingRepository,
      })
    );
    const moneyArg = hoisted.transferMoneyMock.mock.calls[0][0].amountMinor as {
      toCents: () => number;
    };
    expect(moneyArg.toCents()).toBe(15000);

    const transferLog = logger.info.mock.calls.find(
      ([message]) => message === 'PayNote transfer triggered'
    );
    expect(transferLog).toBeTruthy();
    expect(transferLog?.[1]).toEqual(
      expect.objectContaining({
        eventId: 'event-123',
        payerAccountId: 'acct-123',
        payerAccountNumber: '9559276001',
        payeeAccountNumber: '9595234002',
        transferAmountMinor: 15000,
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('logs events without capture request without extracted details', async () => {
    const payload = { id: 'event-456' };
    const eventPayload = {
      id: 'event-456',
      object: {
        blueId: 'a23',
        document: {
          payerAccountNumber: { value: '1111111111' },
          payeeAccountNumber: { value: '2222222222' },
          amount: { total: { value: 1 } },
          payNoteBankId: { value: 'bank-note-456' },
        },
        emitted: [{ type: { name: 'Some Other Event' } }],
      },
    };

    bankingRepository.getAccountIdByNumber.mockResolvedValue('acct-123');
    bankingRepository.getAccountById.mockResolvedValue({
      id: 'acct-123',
      ownerUserId: 'user-456',
    });

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue(eventPayload),
    });

    await payNoteWebhookHandler({ body: payload } as any);

    const receivedLog = logger.info.mock.calls.find(
      ([message]) => message === 'Received PayNote webhook'
    );
    expect(receivedLog).toBeTruthy();
    expect(receivedLog?.[1]).toEqual(
      expect.objectContaining({
        eventId: 'event-456',
        events: [{ type: { name: 'Some Other Event' } }],
        payNoteBankId: 'bank-note-456',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      })
    );
    const ignoredLog = logger.info.mock.calls.find(
      ([message]) => message === 'PayNote webhook event ignored'
    );
    expect(ignoredLog).toBeTruthy();
    expect(ignoredLog?.[1]).toEqual(
      expect.objectContaining({
        eventId: 'event-456',
        eventType: 'Some Other Event',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      })
    );
    expect(hoisted.transferMoneyMock).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and exits when payload lacks event id', async () => {
    const response = await payNoteWebhookHandler({
      body: {},
    } as any);

    expect(logger.error).toHaveBeenCalledWith(
      'PayNote webhook received payload without valid id',
      expect.objectContaining({ payload: {} })
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hoisted.transferMoneyMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      note: 'PayNote webhook received payload without valid id',
    });
  });

  it('returns note when unable to download event payload', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: vi.fn(),
    });

    const response = await payNoteWebhookHandler({
      body: { id: 'event-999' },
    } as any);

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to download PayNote event from MyOS',
      expect.objectContaining({
        eventId: 'event-999',
        status: 503,
        statusText: 'Service Unavailable',
      })
    );
    expect(response.body).toEqual({
      status: 'ok',
      note: 'Failed to download PayNote event from MyOS',
    });
  });
});
