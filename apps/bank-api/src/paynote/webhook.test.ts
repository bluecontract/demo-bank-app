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
        sessionId: 'session-1',
        document: {
          payerAccountNumber: { value: '9559276001' },
          payeeAccountNumber: { value: '9595234002' },
          amount: {
            total: 15000,
          },
          name: 'Invoice Q3',
        },
        emitted: [
          { type: { name: 'Document Processing Initiated' } },
          { type: { name: 'Reserve Funds and Capture Immediately Requested' } },
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

    expect(logger.info).toHaveBeenCalledWith(
      'Received PayNote webhook',
      expect.objectContaining({
        eventId: 'event-123',
        emittedContainsCapture: true,
        emittedEventNames: [
          'Document Processing Initiated',
          'Reserve Funds and Capture Immediately Requested',
        ],
        sessionId: 'session-1',
        payerAccountNumber: '9559276001',
        payeeAccountNumber: '9595234002',
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
          idempotencyKey: 'session-1',
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

    expect(logger.info).toHaveBeenCalledWith(
      'PayNote capture transfer executed',
      expect.objectContaining({
        eventId: 'event-123',
        txnId: 'txn-789',
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
        sessionId: 'session-2',
        document: {
          payerAccountNumber: { value: '1111111111' },
          payeeAccountNumber: { value: '2222222222' },
        },
        emitted: [{ type: { name: 'Some Other Event' } }],
      },
    };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue(eventPayload),
    });

    await payNoteWebhookHandler({ body: payload } as any);

    expect(logger.info).toHaveBeenCalledWith(
      'Received PayNote webhook',
      expect.objectContaining({
        eventId: 'event-456',
        emittedContainsCapture: false,
        emittedEventNames: ['Some Other Event'],
        sessionId: 'session-2',
        payerAccountNumber: '1111111111',
        payeeAccountNumber: '2222222222',
      })
    );
    expect(hoisted.transferMoneyMock).not.toHaveBeenCalled();
    expect(bankingRepository.getAccountIdByNumber).not.toHaveBeenCalled();
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

  it('returns note when capture event lacks amount', async () => {
    const payload = { id: 'event-321' };
    const eventPayload = {
      id: 'event-321',
      object: {
        sessionId: 'session-xyz',
        document: {
          payerAccountNumber: { value: '1111111111' },
          payeeAccountNumber: { value: '2222222222' },
          amount: {
            total: 0,
          },
        },
        emitted: [
          { type: { name: 'Reserve Funds and Capture Immediately Requested' } },
        ],
      },
    };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue(eventPayload),
    });

    const response = await payNoteWebhookHandler({ body: payload } as any);

    expect(response.body).toEqual({
      status: 'ok',
      note: 'PayNote capture event missing amount, transfer skipped',
    });
    expect(hoisted.transferMoneyMock).not.toHaveBeenCalled();
  });
});
