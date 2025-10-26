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

const hoisted = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
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
    });

    bankingRepository = {
      getAccountIdByNumber: vi.fn().mockResolvedValue(baseAccount.id),
      getAccountById: vi.fn().mockResolvedValue(baseAccount),
    } as unknown as DynamoBankingRepository;

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      metrics,
      getMyOsCredentials,
      bankingRepository,
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
    expect(logger.info).toHaveBeenCalledWith(
      'PayNote details fetched successfully',
      expect.objectContaining({ myosEventId })
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
    const foreignAccount = new Account({
      id: 'acc-999',
      accountNumber: TEST_ACCOUNT_NUMBER,
      name: 'Checking',
      ownerUserId: 'someone-else',
      status: 'ACTIVE',
      currency: 'USD',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      ledgerBalanceMinor: new Money(1_000_00),
      availableBalanceMinor: new Money(1_000_00),
      balanceVersion: 1,
    });

    vi.mocked(bankingRepository.getAccountById).mockResolvedValueOnce(
      foreignAccount
    );

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
      expect.objectContaining({ myosEventId: 'event-500' })
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
