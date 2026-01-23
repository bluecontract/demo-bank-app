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

const hoistedFacade = vi.hoisted(() => ({
  getAccountForUserMock: vi.fn(),
}));

const hoistedRepositories = vi.hoisted(() => ({
  getPayNoteMock: vi.fn(),
  getDeliveryByDocumentIdMock: vi.fn(),
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
  let bankingRepository: DynamoBankingRepository;
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

    bankingRepository = {
      getAccountIdByNumber: vi.fn().mockResolvedValue(baseAccount.id),
      getAccountById: vi.fn().mockResolvedValue(baseAccount),
    } as unknown as DynamoBankingRepository;

    hoistedFacade.getAccountForUserMock.mockReset();
    hoistedRepositories.getPayNoteMock.mockReset();
    hoistedRepositories.getDeliveryByDocumentIdMock.mockReset();

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

    const bankingFacade = {
      getAccountByNumber: vi.fn(),
      getAccountForUser: hoistedFacade.getAccountForUserMock,
      transferFunds: vi.fn(),
      reserveFunds: vi.fn(),
      captureHold: vi.fn(),
    };

    const payNoteRepository = {
      getPayNote: hoistedRepositories.getPayNoteMock,
      getPayNoteBySessionId: vi.fn(),
      savePayNote: vi.fn(),
    };

    const payNoteDeliveryRepository = {
      markEventProcessed: vi.fn(),
      getDelivery: vi.fn(),
      getDeliveryByDocumentId: hoistedRepositories.getDeliveryByDocumentIdMock,
      getDeliveryBySessionId: vi.fn(),
      getDeliveryByBootstrapSessionId: vi.fn(),
      getDeliveryByPayNoteDocumentId: vi.fn(),
      getDeliveryByCardTransactionDetails: vi.fn(),
      saveDelivery: vi.fn(),
      listDeliveriesByUserId: vi.fn(),
    };

    const blueIdCalculator = {
      fromObject: vi.fn(),
      fromYaml: vi.fn(),
      toReversedJson: (value: unknown) => value,
    };

    hoisted.getDependenciesMock.mockResolvedValue({
      logger,
      metrics,
      bankingRepository,
      holdRepository,
      bankingFacade,
      payNoteRepository,
      payNoteDeliveryRepository,
      blueIdCalculator,
      clock: { now: () => new Date() },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createRequestContext = () =>
    ({
      headers: setAuthHeader(new Headers()),
    } as unknown as MaybeAuthenticatedTsRestRequestContext);

  it('returns PayNote details when record exists', async () => {
    const payNoteDocumentId = 'doc-123';

    hoistedRepositories.getPayNoteMock.mockResolvedValue({
      payNoteDocumentId,
      sessionIds: ['session-1'],
      accountNumber: TEST_ACCOUNT_NUMBER,
      userId: TEST_USER_ID,
      document: {
        payerAccountNumber: { value: TEST_ACCOUNT_NUMBER },
      },
      transactionRequest: [
        { type: { name: 'PayNote/Reserve Funds Requested' } },
      ],
      triggerEvent: { actor: 'payerChannel' },
      createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2024-01-02T00:00:00.000Z').toISOString(),
    });

    const response = await getPayNoteDetailsHandler(
      {
        params: { accountNumber: TEST_ACCOUNT_NUMBER, payNoteDocumentId },
      } as any,
      { request: createRequestContext() }
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      payNoteDocumentId,
      document: {
        payerAccountNumber: {
          value: TEST_ACCOUNT_NUMBER,
        },
      },
      fetchedAt: '2024-02-01T12:00:00.000Z',
    });

    const successLog = logger.debug.mock.calls.find(
      ([message]) => message === 'PayNote details fetched successfully'
    );
    expect(successLog?.[1]).toEqual(
      expect.objectContaining({
        payNoteDocumentId,
        hasDocument: true,
      })
    );
  });

  it('returns 404 if account is not owned by the user', async () => {
    hoistedFacade.getAccountForUserMock.mockResolvedValueOnce(null);

    const response = await getPayNoteDetailsHandler(
      {
        params: {
          accountNumber: TEST_ACCOUNT_NUMBER,
          payNoteDocumentId: 'doc-123',
        },
      } as any,
      { request: createRequestContext() }
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.ACCOUNT_NOT_FOUND,
    });
  });

  it('returns 404 when paynote record is missing', async () => {
    hoistedRepositories.getPayNoteMock.mockResolvedValueOnce(null);

    const response = await getPayNoteDetailsHandler(
      {
        params: {
          accountNumber: TEST_ACCOUNT_NUMBER,
          payNoteDocumentId: 'doc-404',
        },
      } as any,
      { request: createRequestContext() }
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.PAYNOTE_NOT_FOUND,
    });
  });

  it('throws when authentication is missing', async () => {
    await expect(
      getPayNoteDetailsHandler(
        {
          params: {
            accountNumber: TEST_ACCOUNT_NUMBER,
            payNoteDocumentId: 'doc-123',
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
