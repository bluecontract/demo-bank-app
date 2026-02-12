import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankingRepository, HoldRepository } from '@demo-bank-app/banking';
import type { PowertoolsLogger } from '@demo-bank-app/shared-observability';
import { createBankingFacade } from './bankingFacade';

const bankingMocks = vi.hoisted(() => ({
  transferMoney: vi.fn(),
  reserveFunds: vi.fn(),
  captureHold: vi.fn(),
  partialCaptureHold: vi.fn(),
}));

vi.mock('@demo-bank-app/banking', () => ({
  Money: class MockMoney {
    constructor(readonly value: number) {}
  },
  transferMoney: bankingMocks.transferMoney,
  reserveFunds: bankingMocks.reserveFunds,
  captureHold: bankingMocks.captureHold,
  partialCaptureHold: bankingMocks.partialCaptureHold,
}));

const createDependencies = () => {
  const bankingRepository = {
    getAccountIdByNumber: vi.fn(),
    getAccountById: vi.fn(),
  } as unknown as BankingRepository;
  const holdRepository = {} as HoldRepository;
  const logger = {} as PowertoolsLogger;

  return {
    bankingRepository,
    holdRepository,
    logger,
  };
};

describe('createBankingFacade - capture branch routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes captureHold with amountMinor to partialCaptureHold and returns hold', async () => {
    const deps = createDependencies();
    const facade = createBankingFacade(deps);

    const hold = { holdId: 'hold-1', status: 'PARTIALLY_CAPTURED' };
    bankingMocks.partialCaptureHold.mockResolvedValueOnce({
      hold,
      transactionId: 'txn-1',
      created: true,
    });

    const result = await facade.captureHold({
      holdId: 'hold-1',
      userId: 'user-1',
      idempotencyKey: 'idem-1',
      amountMinor: 1500,
      counterpartyAccountNumber: '9876543210',
      payNoteDocumentId: 'doc-1',
    });

    expect(bankingMocks.partialCaptureHold).toHaveBeenCalledWith(
      {
        holdId: 'hold-1',
        userId: 'user-1',
        idempotencyKey: 'idem-1',
        amountMinor: 1500,
        counterpartyAccountNumber: '9876543210',
        payNoteDocumentId: 'doc-1',
      },
      {
        bankingRepository: deps.bankingRepository,
        holdRepository: deps.holdRepository,
        logger: deps.logger,
      }
    );
    expect(bankingMocks.captureHold).not.toHaveBeenCalled();
    expect(result).toEqual(hold);
  });

  it('routes captureHold without amountMinor to captureHold', async () => {
    const deps = createDependencies();
    const facade = createBankingFacade(deps);

    const hold = { holdId: 'hold-2', status: 'CAPTURED' };
    bankingMocks.captureHold.mockResolvedValueOnce(hold);

    const result = await facade.captureHold({
      holdId: 'hold-2',
      userId: 'user-2',
      idempotencyKey: 'idem-2',
      counterpartyAccountNumber: '1234567890',
      payNoteDocumentId: 'doc-2',
    });

    expect(bankingMocks.captureHold).toHaveBeenCalledWith(
      {
        holdId: 'hold-2',
        userId: 'user-2',
        idempotencyKey: 'idem-2',
        counterpartyAccountNumber: '1234567890',
        payNoteDocumentId: 'doc-2',
      },
      {
        bankingRepository: deps.bankingRepository,
        holdRepository: deps.holdRepository,
        logger: deps.logger,
      }
    );
    expect(bankingMocks.partialCaptureHold).not.toHaveBeenCalled();
    expect(result).toEqual(hold);
  });
});
