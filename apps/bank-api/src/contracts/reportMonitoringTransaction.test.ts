import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractRecord } from '@demo-bank-app/contracts';
import { reportCardTransactionToMonitoringSubscribers } from './reportMonitoringTransaction';

const hoisted = vi.hoisted(() => ({
  runGuarantorUpdateMock: vi.fn(),
}));

vi.mock('@demo-bank-app/paynotes', async () => {
  const actual = await vi.importActual<
    typeof import('@demo-bank-app/paynotes')
  >('@demo-bank-app/paynotes');
  return {
    ...actual,
    runGuarantorUpdate: hoisted.runGuarantorUpdateMock,
  };
});

const createContract = (): ContractRecord => ({
  contractId: 'contract-1',
  typeBlueId: 'type-1',
  displayName: 'Contract',
  sessionId: 'session-1',
  documentId: 'document-1',
  userId: 'user-1',
  monitoringSubscriptions: [
    {
      subscriptionId: 'card-monitoring:merchant-1',
      targetMerchantId: 'merchant-1',
      requestedEvents: ['transaction'],
      status: 'active',
      requestEventId: 'event-1',
      requestEventIndex: 0,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

describe('reportCardTransactionToMonitoringSubscribers', () => {
  const contractRepository = {
    listContractsByUserId: vi.fn(),
    getContract: vi.fn(),
    saveContract: vi.fn(),
  };

  const myOsClient = {
    getCredentials: vi.fn(),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    contractRepository.listContractsByUserId.mockReset();
    contractRepository.getContract.mockReset();
    contractRepository.saveContract.mockReset();
    myOsClient.getCredentials.mockReset();
    logger.info.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
    hoisted.runGuarantorUpdateMock.mockReset();

    contractRepository.listContractsByUserId.mockResolvedValue([
      { contractId: 'contract-1' },
    ]);
    contractRepository.getContract.mockResolvedValue(createContract());
    contractRepository.saveContract.mockResolvedValue(undefined);
    myOsClient.getCredentials.mockResolvedValue({
      apiKey: 'key',
      accountId: 'account-1',
      baseUrl: 'https://myos.test',
    });
    hoisted.runGuarantorUpdateMock.mockResolvedValue(true);
  });

  it('reports transaction to active subscriber and updates contract linkage', async () => {
    await reportCardTransactionToMonitoringSubscribers({
      contractRepository: contractRepository as any,
      myOsClient: myOsClient as any,
      logger,
      userId: 'user-1',
      merchantId: 'merchant-1',
      reportEvent: { type: 'PayNote/Card Transaction Report' },
      reportTransactionId: 'txn-1',
      relatedHoldId: 'hold-1',
      relatedTransactionId: 'txn-1',
    });

    expect(hoisted.runGuarantorUpdateMock).toHaveBeenCalledTimes(1);
    expect(contractRepository.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        relatedHoldIds: ['hold-1'],
        relatedTransactionIds: ['txn-1'],
        monitoringSubscriptions: expect.arrayContaining([
          expect.objectContaining({
            subscriptionId: 'card-monitoring:merchant-1',
            reportedTransactionIds: ['txn-1'],
          }),
        ]),
      })
    );
  });

  it('skips duplicate report delivery when transaction was already reported', async () => {
    contractRepository.getContract.mockResolvedValue({
      ...createContract(),
      monitoringSubscriptions: [
        {
          subscriptionId: 'card-monitoring:merchant-1',
          targetMerchantId: 'merchant-1',
          requestedEvents: ['transaction'],
          status: 'active',
          requestEventId: 'event-1',
          requestEventIndex: 0,
          reportedTransactionIds: ['txn-1'],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    await reportCardTransactionToMonitoringSubscribers({
      contractRepository: contractRepository as any,
      myOsClient: myOsClient as any,
      logger,
      userId: 'user-1',
      merchantId: 'merchant-1',
      reportEvent: { type: 'PayNote/Card Transaction Report' },
      reportTransactionId: 'txn-1',
    });

    expect(hoisted.runGuarantorUpdateMock).not.toHaveBeenCalled();
    expect(contractRepository.saveContract).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Skipped duplicate monitoring report delivery',
      expect.objectContaining({
        contractId: 'contract-1',
        reportTransactionId: 'txn-1',
      })
    );
  });

  it('logs warning and does not save contract when guarantor update fails', async () => {
    hoisted.runGuarantorUpdateMock.mockResolvedValue(false);

    await reportCardTransactionToMonitoringSubscribers({
      contractRepository: contractRepository as any,
      myOsClient: myOsClient as any,
      logger,
      userId: 'user-1',
      merchantId: 'merchant-1',
      reportEvent: { type: 'PayNote/Card Transaction Report' },
      reportTransactionId: 'txn-1',
    });

    expect(contractRepository.saveContract).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Monitoring report delivery failed for contract',
      expect.objectContaining({
        contractId: 'contract-1',
        reportTransactionId: 'txn-1',
      })
    );
  });

  it('ignores contracts without active monitoring subscriptions for target merchant', async () => {
    contractRepository.getContract.mockResolvedValue({
      ...createContract(),
      monitoringSubscriptions: [
        {
          subscriptionId: 'card-monitoring:merchant-1',
          targetMerchantId: 'merchant-1',
          requestedEvents: ['transaction'],
          status: 'pending',
          requestEventId: 'event-1',
          requestEventIndex: 0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    await reportCardTransactionToMonitoringSubscribers({
      contractRepository: contractRepository as any,
      myOsClient: myOsClient as any,
      logger,
      userId: 'user-1',
      merchantId: 'merchant-1',
      reportEvent: { type: 'PayNote/Card Transaction Report' },
      reportTransactionId: 'txn-1',
    });

    expect(hoisted.runGuarantorUpdateMock).not.toHaveBeenCalled();
    expect(contractRepository.saveContract).not.toHaveBeenCalled();
  });
});
