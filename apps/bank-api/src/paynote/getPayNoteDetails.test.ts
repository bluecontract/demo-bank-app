import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { getPayNoteDetailsHandler } from './getPayNoteDetails';
import type {
  PowertoolsLogger,
  PowertoolsMetrics,
} from '@demo-bank-app/shared-observability';
import type { DynamoBankingRepository } from '@demo-bank-app/banking';
import { Account, Money } from '@demo-bank-app/banking';
import { MaybeAuthenticatedTsRestRequestContext } from '../auth/middleware';
import { ERROR_CODES } from '../shared/errors';
import { UnauthorizedRequestError } from '../auth/errors';
import {
  createHttpMyOsGateway,
  createBlueIdCalculator,
} from '@demo-bank-app/paynotes';

const hoisted = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
}));

const hoistedFacade = vi.hoisted(() => ({
  getAccountForUserMock: vi.fn(),
  getAccountByNumberMock: vi.fn(),
  transferFundsMock: vi.fn(),
  reserveFundsMock: vi.fn(),
  captureHoldMock: vi.fn(),
}));

vi.mock('./dependencies', () => ({
  getDependencies: hoisted.getDependenciesMock,
}));

const TEST_JWT_SECRET = 'test-secret';
const TEST_USER_ID = 'user-1';
const TEST_ACCOUNT_NUMBER = '1234567890';

const createTestJwt = () =>
  jwt.sign({ sub: TEST_USER_ID, email: 'user@example.com' }, TEST_JWT_SECRET);

const setAuthHeader = (headers: Headers, token = createTestJwt()) => {
  headers.set('cookie', `demoAuth=${token}`);
  return headers;
};

describe('getPayNoteDetailsHandler', () => {
  let logger: PowertoolsLogger;
  let metrics: PowertoolsMetrics;
  let getMyOsCredentials: ReturnType<typeof vi.fn>;
  let bankingRepository: DynamoBankingRepository;
  let originalFetch: typeof global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  const holdRepository = {};

  const baseAccount = new Account({
    id: 'acc-123',
    accountNumber: TEST_ACCOUNT_NUMBER,
    name: 'Checking',
    ownerUserId: TEST_USER_ID,
    status: 'ACTIVE',
    currency: 'USD',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ledgerBalanceMinor: new Money(1_000_00),
    availableBalanceMinor: new Money(1_000_00),
    balanceVersion: 1,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-01T12:00:00.000Z'));

    originalFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      addContext: vi.fn(),
      setCorrelationId: vi.fn(),
    } as unknown as PowertoolsLogger;

    metrics = {
      addMetric: vi.fn(),
      addMetadata: vi.fn(),
      publishStoredMetrics: vi.fn(),
      setDefaultDimensions: vi.fn(),
    } as unknown as PowertoolsMetrics;

    getMyOsCredentials = vi.fn().mockResolvedValue({
      apiKey: 'api-key',
      baseUrl: 'https://myos.example.com',
      accountId: 'acct-myos',
    });

    bankingRepository = {
      getAccountIdByNumber: vi.fn().mockResolvedValue(baseAccount.id),
      getAccountById: vi.fn().mockResolvedValue(baseAccount),
    } as unknown as DynamoBankingRepository;

    hoistedFacade.getAccountForUserMock.mockReset();
    hoistedFacade.getAccountByNumberMock.mockReset();
    hoistedFacade.transferFundsMock.mockReset();
    hoistedFacade.reserveFundsMock.mockReset();
    hoistedFacade.captureHoldMock.mockReset();

    hoistedFacade.getAccountForUserMock.mockImplementation(
      async (accountNumber: string, userId: string) => {
        if (
          accountNumber === baseAccount.accountNumber &&
          userId === baseAccount.ownerUserId
        ) {
          return {
            id: baseAccount.id,
            accountNumber: baseAccount.accountNumber,
            ownerUserId: baseAccount.ownerUserId,
          };
        }
        return null;
      }
    );

    const myOsClient = createHttpMyOsGateway(getMyOsCredentials);
    const bankingFacade = {
      getAccountByNumber: hoistedFacade.getAccountByNumberMock,
      getAccountForUser: hoistedFacade.getAccountForUserMock,
      transferFunds: hoistedFacade.transferFundsMock,
      reserveFunds: hoistedFacade.reserveFundsMock,
      captureHold: hoistedFacade.captureHoldMock,
    };

    const blueIdCalculator = createBlueIdCalculator();

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      metrics,
      getMyOsCredentials,
      bankingRepository,
      holdRepository,
      myOsClient,
      bankingFacade,
      blueIdCalculator,
      clock: { now: () => new Date() },
      idGenerator: { generate: vi.fn() },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const createRequestContext = () =>
    ({
      headers: setAuthHeader(new Headers()),
    } as unknown as MaybeAuthenticatedTsRestRequestContext);

  it('returns PayNote details when MyOS lookup succeeds', async () => {
    const myosEventId = 'event-123';
    const payload = {
      id: myosEventId,
      object: {
        document: {
          payerAccountNumber: { value: TEST_ACCOUNT_NUMBER },
        },
        documentYaml: '---\npaynote',
        emitted: [{ type: { name: 'Reserve Funds Requested' } }],
        triggeredBy: { actor: 'payerChannel' },
      },
    };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(payload),
      text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    });

    const response = await getPayNoteDetailsHandler(
      {
        params: { accountNumber: TEST_ACCOUNT_NUMBER, myosEventId },
      } as any,
      { request: createRequestContext() }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://myos.example.com/myos-events/event-123',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'api-key',
          'Content-Type': 'application/json',
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      myosEventId,
      document: {
        payerAccountNumber: {
          value: TEST_ACCOUNT_NUMBER,
        },
      },
      fetchedAt: '2024-02-01T12:00:00.000Z',
    });

    expect(response.body.document?.payerAccountNumber?.type).toBeDefined();
    expect(Array.isArray(response.body.transactionRequest?.items)).toBe(true);
    expect(response.body.transactionRequest?.items?.length).toBeGreaterThan(0);
    expect(response.body.triggerEvent).toMatchObject({
      actor: { value: 'payerChannel' },
    });
    const successLog = logger.info.mock.calls.find(
      ([message]) => message === 'PayNote details fetched successfully'
    );
    expect(successLog?.[1]).toEqual(
      expect.objectContaining({
        myOsEventId: myosEventId,
        hasDocument: true,
      })
    );
  });

  it('returns document object when documentYaml is missing', async () => {
    const myosEventId = 'event-serialize';
    const payload = {
      id: myosEventId,
      object: {
        document: {
          payerAccountNumber: { value: TEST_ACCOUNT_NUMBER },
          payeeAccountNumber: { value: '0987654321' },
        },
        emitted: [],
        triggeredBy: null,
      },
    };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(payload),
      text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    });

    const response = await getPayNoteDetailsHandler(
      {
        params: { accountNumber: TEST_ACCOUNT_NUMBER, myosEventId },
      } as any,
      { request: createRequestContext() }
    );

    expect(response.status).toBe(200);
    expect(response.body.document).toMatchObject({
      payerAccountNumber: { value: TEST_ACCOUNT_NUMBER },
      payeeAccountNumber: { value: '0987654321' },
    });
  });

  it('returns 404 if account is not owned by the user', async () => {
    hoistedFacade.getAccountForUserMock.mockResolvedValueOnce(null);

    const response = await getPayNoteDetailsHandler(
      {
        params: {
          accountNumber: TEST_ACCOUNT_NUMBER,
          myosEventId: 'event-123',
        },
      } as any,
      { request: createRequestContext() }
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.ACCOUNT_NOT_FOUND,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 when MyOS reports missing event', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue('not found'),
    });

    const response = await getPayNoteDetailsHandler(
      {
        params: {
          accountNumber: TEST_ACCOUNT_NUMBER,
          myosEventId: 'event-404',
        },
      } as any,
      { request: createRequestContext() }
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.PAYNOTE_NOT_FOUND,
    });
  });

  it('returns 500 when MyOS request fails unexpectedly', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('server error'),
    });

    const response = await getPayNoteDetailsHandler(
      {
        params: {
          accountNumber: TEST_ACCOUNT_NUMBER,
          myosEventId: 'event-500',
        },
      } as any,
      { request: createRequestContext() }
    );

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      detail: 'server error',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to retrieve PayNote event from MyOS',
      expect.objectContaining({ myOsEventId: 'event-500' })
    );
  });

  it('throws when authentication is missing', async () => {
    await expect(
      getPayNoteDetailsHandler(
        {
          params: {
            accountNumber: TEST_ACCOUNT_NUMBER,
            myosEventId: 'event-123',
          },
        } as any,
        {
          request: {
            headers: new Headers(),
          } as unknown as MaybeAuthenticatedTsRestRequestContext,
        }
      )
    ).rejects.toThrow(
      new UnauthorizedRequestError(
        'Failed to extract auth info from the request'
      )
    );
  });
});
