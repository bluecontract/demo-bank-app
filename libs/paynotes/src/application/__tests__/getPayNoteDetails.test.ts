import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPayNoteDetails } from '../getPayNoteDetails';
import type {
  BankingFacade,
  BlueIdCalculator,
  MyOsClient,
  MyOsFetchEventResult,
} from '../ports';

const fixedDate = new Date('2024-01-02T12:00:00.000Z');

const createClock = () => ({
  now: vi.fn(() => fixedDate),
});

const createBlueIdCalculator = (): BlueIdCalculator => ({
  fromYaml: vi.fn(),
  fromObject: vi.fn(),
  toReversedJson: vi.fn(payload => payload),
});

const createBankingFacade = (): BankingFacade => ({
  getAccountForUser: vi.fn().mockResolvedValue({
    id: 'acct-1',
    accountNumber: 'acct-1',
    ownerUserId: 'user-1',
  }),
  getAccountByNumber: vi.fn(),
  transferFunds: vi.fn(),
  reserveFunds: vi.fn(),
  captureHold: vi.fn(),
});

const createMyOsClient = (result: MyOsFetchEventResult): MyOsClient => ({
  getCredentials: vi.fn(),
  bootstrapDocument: vi.fn(),
  fetchEvent: vi.fn().mockResolvedValue(result),
});

describe('getPayNoteDetails', () => {
  let bankingFacade: BankingFacade;
  let blueIdCalculator: BlueIdCalculator;
  let clock: ReturnType<typeof createClock>;

  beforeEach(() => {
    bankingFacade = createBankingFacade();
    blueIdCalculator = createBlueIdCalculator();
    clock = createClock();
  });

  it('returns account-not-found when user does not own account', async () => {
    bankingFacade.getAccountForUser = vi.fn().mockResolvedValue(null);
    const myOsClient = createMyOsClient({
      kind: 'not-found',
      status: 404,
    });

    const result = await getPayNoteDetails(
      {
        accountNumber: 'acct-1',
        myOsEventId: 'evt-1',
        userId: 'user-1',
      },
      {
        bankingFacade,
        myOsClient,
        blueIdCalculator,
        clock,
      }
    );

    expect(result.type).toBe('account-not-found');
  });

  it('returns event-not-found when MyOS reports missing event', async () => {
    const myOsClient = createMyOsClient({
      kind: 'not-found',
      status: 404,
    });

    const result = await getPayNoteDetails(
      {
        accountNumber: 'acct-1',
        myOsEventId: 'evt-1',
        userId: 'user-1',
      },
      {
        bankingFacade,
        myOsClient,
        blueIdCalculator,
        clock,
      }
    );

    expect(result.type).toBe('event-not-found');
    expect(result.logs[0]).toEqual({
      level: 'warn',
      message: 'PayNote event not found in MyOS',
      context: {
        accountNumber: 'acct-1',
        myOsEventId: 'evt-1',
      },
    });
  });

  it('returns external-error for MyOS request failures', async () => {
    const myOsClient = createMyOsClient({
      kind: 'http-error',
      status: 500,
      statusText: 'Internal Error',
    });

    const result = await getPayNoteDetails(
      {
        accountNumber: 'acct-1',
        myOsEventId: 'evt-1',
        userId: 'user-1',
      },
      {
        bankingFacade,
        myOsClient,
        blueIdCalculator,
        clock,
      }
    );

    expect(result.type).toBe('external-error');
    if (result.type !== 'external-error') {
      throw new Error('Expected external-error result');
    }
    expect(result.status).toBe(500);
    expect(result.logs[0].message).toBe(
      'Failed to retrieve PayNote event from MyOS'
    );
  });

  it('returns success payload when event belongs to account', async () => {
    const myOsClient = createMyOsClient({
      kind: 'success',
      payload: {
        object: {
          document: {
            payerAccountNumber: { value: 'acct-1' },
          },
          emitted: [{ id: 1 }],
          triggeredBy: { id: 2 },
        },
      },
    });

    const result = await getPayNoteDetails(
      {
        accountNumber: 'acct-1',
        myOsEventId: 'evt-1',
        userId: 'user-1',
      },
      {
        bankingFacade,
        myOsClient,
        blueIdCalculator,
        clock,
      }
    );

    expect(result.type).toBe('success');
    if (result.type !== 'success') {
      throw new Error('Expected success result');
    }
    expect(result.detail).toEqual({
      myosEventId: 'evt-1',
      document: {
        payerAccountNumber: { value: 'acct-1' },
      },
      transactionRequest: [{ id: 1 }],
      triggerEvent: { id: 2 },
      fetchedAt: fixedDate.toISOString(),
    });
    expect(result.logs.at(-1)).toEqual({
      level: 'info',
      message: 'PayNote details fetched successfully',
      context: expect.objectContaining({
        accountNumber: 'acct-1',
        myOsEventId: 'evt-1',
        hasDocument: true,
      }),
    });
  });

  it('treats mismatched document as not-found', async () => {
    const myOsClient = createMyOsClient({
      kind: 'success',
      payload: {
        object: {
          document: {
            payerAccountNumber: { value: 'different-account' },
          },
        },
      },
    });

    const result = await getPayNoteDetails(
      {
        accountNumber: 'acct-1',
        myOsEventId: 'evt-1',
        userId: 'user-1',
      },
      {
        bankingFacade,
        myOsClient,
        blueIdCalculator,
        clock,
      }
    );

    expect(result.type).toBe('event-not-found');
    expect(result.logs[0]).toEqual({
      level: 'warn',
      message: 'PayNote event document does not match account owner',
      context: {
        accountNumber: 'acct-1',
        myOsEventId: 'evt-1',
        payerAccountFromDocument: 'different-account',
      },
    });
  });
});
