import { describe, it, expect, vi } from 'vitest';
import { getPayNoteDetails } from './getPayNoteDetails';
import type {
  BankingFacade,
  MyOsClient,
  BlueIdCalculator,
  ClockPort,
} from '../ports';

describe('getPayNoteDetails', () => {
  const createDependencies = () => {
    const bankingFacade: BankingFacade = {
      getAccountForUser: vi.fn().mockResolvedValue({
        id: 'account-id',
        accountNumber: '1234567890',
      }),
      getAccountByNumber: vi.fn(),
      transferFunds: vi.fn(),
      reserveFunds: vi.fn(),
      captureHold: vi.fn(),
    };

    const myOsClient: MyOsClient = {
      getCredentials: vi.fn(),
      bootstrapDocument: vi.fn(),
      fetchEvent: vi.fn().mockResolvedValue({
        kind: 'success',
        payload: {
          object: {
            document: {
              payerAccountNumber: { value: '1234567890' },
            },
          },
        },
      }),
    };

    const blueIdCalculator: BlueIdCalculator = {
      fromObject: vi.fn(),
      fromYaml: vi.fn(),
      toReversedJson: vi.fn((value: unknown) => value),
    };

    const clock: ClockPort = {
      now: () => new Date('2024-01-01T00:00:00.000Z'),
    };

    return { bankingFacade, myOsClient, blueIdCalculator, clock };
  };

  it('returns account-not-found when user has no account', async () => {
    const deps = createDependencies();
    vi.mocked(deps.bankingFacade.getAccountForUser).mockResolvedValueOnce(null);

    const result = await getPayNoteDetails(
      {
        accountNumber: '1234567890',
        myOsEventId: 'event-1',
        userId: 'user-123',
      },
      deps
    );

    expect(result.type).toBe('account-not-found');
  });

  it('returns success when event is fetched', async () => {
    const deps = createDependencies();

    const result = await getPayNoteDetails(
      {
        accountNumber: '1234567890',
        myOsEventId: 'event-1',
        userId: 'user-123',
      },
      deps
    );

    if (result.type !== 'success') {
      throw new Error('Expected success result');
    }

    expect(result.detail.myosEventId).toBe('event-1');
  });
});
