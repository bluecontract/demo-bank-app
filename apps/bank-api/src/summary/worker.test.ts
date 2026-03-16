import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSummaryJob } from './worker';

const hoistedDeps = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
}));

const hoistedSummary = vi.hoisted(() => ({
  generateContractSummaryForContractMock: vi.fn(),
  generatePayNoteDeliverySummaryForSessionIdMock: vi.fn(),
}));

vi.mock('../paynote/dependencies', () => ({
  getDependencies: hoistedDeps.getDependenciesMock,
}));

vi.mock('../contracts/generateContractSummary', () => ({
  generateContractSummaryForContract:
    hoistedSummary.generateContractSummaryForContractMock,
}));

vi.mock('../paynote/generatePayNoteDeliverySummary', () => ({
  generatePayNoteDeliverySummaryForSessionId:
    hoistedSummary.generatePayNoteDeliverySummaryForSessionIdMock,
}));

describe('handleSummaryJob (contract-summary)', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const contractRepository = {
    getContract: vi.fn(),
  };

  const summaryInputStore = {
    get: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    hoistedSummary.generateContractSummaryForContractMock.mockResolvedValue({
      summary: {
        story: { headline: 'Summary', overview: [], bullets: [] },
        listPreview: 'Summary',
        nextSteps: { title: 'Next steps', items: [] },
        lastChange: { short: 'Updated', more: 'Updated.' },
      },
      summaryUpdatedAt: '2026-02-08T00:00:00.000Z',
      summarySourceUpdatedAt: '2026-02-08T00:00:00.000Z',
      summaryInputBlueId: 'blueid',
      cached: false,
      model: 'gpt-5',
    });
    hoistedSummary.generatePayNoteDeliverySummaryForSessionIdMock.mockResolvedValue(
      {
        summary: {
          story: { headline: 'Summary', overview: [], bullets: [] },
          listPreview: 'Summary',
          nextSteps: { title: 'Next steps', items: [] },
          lastChange: { short: 'Updated', more: 'Updated.' },
        },
        summaryUpdatedAt: '2026-02-08T00:00:00.000Z',
        summaryInputBlueId: 'blueid',
        cached: false,
        model: 'gpt-5',
      }
    );

    hoistedDeps.getDependenciesMock.mockResolvedValue({
      logger,
      contractRepository,
      summaryInputStore,
      payNoteDeliveryRepository: {},
      getOpenAiApiKey: vi.fn(),
    });
  });

  it('uses snapshot document state but latest projection metadata for summary generation', async () => {
    const snapshotDocument = { name: 'Snapshot state', counter: 1 };
    summaryInputStore.get.mockResolvedValue({
      contractId: 'contract-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      eventId: 'event-1',
      contractSnapshot: {
        contractId: 'contract-1',
        typeBlueId: 'PayNote/PayNote',
        displayName: 'PayNote',
        document: snapshotDocument,
        status: 'reserved',
        updatedAt: '2026-02-08T10:00:00.000Z',
        createdAt: '2026-02-08T09:00:00.000Z',
      },
      createdAt: '2026-02-08T10:00:00.000Z',
    });

    contractRepository.getContract.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'PayNote/PayNote',
      displayName: 'PayNote',
      document: { name: 'Latest state', counter: 2 },
      userId: 'user-1',
      relatedTransactionIds: ['txn-1'],
      relatedHoldIds: ['hold-1'],
      status: 'reserved',
      updatedAt: '2026-02-08T10:00:05.000Z',
      createdAt: '2026-02-08T09:00:00.000Z',
    });

    const result = await handleSummaryJob({
      type: 'contract-summary',
      messageVersion: 1,
      contractId: 'contract-1',
      documentId: 'document-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      reason: 'webhook',
    });

    expect(result).toEqual({ status: 'ok' });
    expect(contractRepository.getContract).toHaveBeenCalledWith('contract-1');
    expect(
      hoistedSummary.generateContractSummaryForContractMock
    ).toHaveBeenCalledTimes(1);

    const summaryCallInput =
      hoistedSummary.generateContractSummaryForContractMock.mock.calls[0]?.[0];
    expect(summaryCallInput.historyEventId).toBe('event-1');
    expect(summaryCallInput.contract.document).toEqual(snapshotDocument);
    expect(summaryCallInput.contract.updatedAt).toBe(
      '2026-02-08T10:00:00.000Z'
    );
    expect(summaryCallInput.contract.userId).toBe('user-1');
    expect(summaryCallInput.contract.relatedTransactionIds).toEqual(['txn-1']);
    expect(summaryCallInput.contract.relatedHoldIds).toEqual(['hold-1']);
  });

  it('forwards source epoch from snapshot for monotonic summary updates', async () => {
    summaryInputStore.get.mockResolvedValue({
      contractId: 'contract-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z#7',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      sourceEpoch: 7,
      contractSnapshot: {
        contractId: 'contract-1',
        typeBlueId: 'PayNote/PayNote',
        displayName: 'PayNote',
        document: { name: 'Snapshot state' },
        status: 'reserved',
        updatedAt: '2026-02-08T10:00:00.000Z',
        createdAt: '2026-02-08T09:00:00.000Z',
      },
      createdAt: '2026-02-08T10:00:00.000Z',
    });

    contractRepository.getContract.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'PayNote/PayNote',
      displayName: 'PayNote',
      document: { name: 'Latest state' },
      userId: 'user-1',
      status: 'reserved',
      updatedAt: '2026-02-08T10:00:05.000Z',
      createdAt: '2026-02-08T09:00:00.000Z',
    });

    const result = await handleSummaryJob({
      type: 'contract-summary',
      messageVersion: 1,
      contractId: 'contract-1',
      documentId: 'document-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z#7',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      sourceEpoch: 7,
      reason: 'webhook',
    });

    expect(result).toEqual({ status: 'ok' });
    const summaryCallInput =
      hoistedSummary.generateContractSummaryForContractMock.mock.calls[0]?.[0];
    expect(summaryCallInput.contract.summarySourceEpoch).toBe(7);
  });

  it('fails with not-ready error when userId is missing for projection updates', async () => {
    summaryInputStore.get.mockResolvedValue({
      contractId: 'contract-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      contractSnapshot: {
        contractId: 'contract-1',
        typeBlueId: 'PayNote/PayNote',
        displayName: 'PayNote',
        document: { name: 'Snapshot state' },
        status: 'reserved',
        updatedAt: '2026-02-08T10:00:00.000Z',
        createdAt: '2026-02-08T09:00:00.000Z',
      },
      createdAt: '2026-02-08T10:00:00.000Z',
    });

    contractRepository.getContract.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'PayNote/PayNote',
      displayName: 'PayNote',
      document: { name: 'Latest state' },
      status: 'reserved',
      updatedAt: '2026-02-08T10:00:05.000Z',
      createdAt: '2026-02-08T09:00:00.000Z',
    });

    await expect(
      handleSummaryJob({
        type: 'contract-summary',
        messageVersion: 1,
        contractId: 'contract-1',
        documentId: 'document-1',
        summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z',
        sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
        reason: 'webhook',
      })
    ).rejects.toThrow('Contract userId not available for summary job');

    expect(
      hoistedSummary.generateContractSummaryForContractMock
    ).not.toHaveBeenCalled();
  });

  it('keeps latest empty relation arrays instead of falling back to stale snapshot relations', async () => {
    summaryInputStore.get.mockResolvedValue({
      contractId: 'contract-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      contractSnapshot: {
        contractId: 'contract-1',
        typeBlueId: 'PayNote/PayNote',
        displayName: 'PayNote',
        document: { name: 'Snapshot state' },
        userId: 'user-1',
        relatedTransactionIds: ['txn-stale'],
        relatedHoldIds: ['hold-stale'],
        status: 'reserved',
        updatedAt: '2026-02-08T10:00:00.000Z',
        createdAt: '2026-02-08T09:00:00.000Z',
      },
      createdAt: '2026-02-08T10:00:00.000Z',
    });

    contractRepository.getContract.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'PayNote/PayNote',
      displayName: 'PayNote',
      document: { name: 'Latest state' },
      userId: 'user-1',
      relatedTransactionIds: [],
      relatedHoldIds: [],
      status: 'reserved',
      updatedAt: '2026-02-08T10:00:05.000Z',
      createdAt: '2026-02-08T09:00:00.000Z',
    });

    const result = await handleSummaryJob({
      type: 'contract-summary',
      messageVersion: 1,
      contractId: 'contract-1',
      documentId: 'document-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      reason: 'webhook',
    });

    expect(result).toEqual({ status: 'ok' });
    const summaryCallInput =
      hoistedSummary.generateContractSummaryForContractMock.mock.calls[0]?.[0];
    expect(summaryCallInput.contract.relatedTransactionIds).toEqual([]);
    expect(summaryCallInput.contract.relatedHoldIds).toEqual([]);
  });

  it('keeps latest undefined relation arrays instead of falling back to stale snapshot relations', async () => {
    summaryInputStore.get.mockResolvedValue({
      contractId: 'contract-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      contractSnapshot: {
        contractId: 'contract-1',
        typeBlueId: 'PayNote/PayNote',
        displayName: 'PayNote',
        document: { name: 'Snapshot state' },
        userId: 'user-1',
        relatedTransactionIds: ['txn-stale'],
        relatedHoldIds: ['hold-stale'],
        status: 'reserved',
        updatedAt: '2026-02-08T10:00:00.000Z',
        createdAt: '2026-02-08T09:00:00.000Z',
      },
      createdAt: '2026-02-08T10:00:00.000Z',
    });

    contractRepository.getContract.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'PayNote/PayNote',
      displayName: 'PayNote',
      document: { name: 'Latest state' },
      userId: 'user-1',
      status: 'reserved',
      updatedAt: '2026-02-08T10:00:05.000Z',
      createdAt: '2026-02-08T09:00:00.000Z',
    });

    const result = await handleSummaryJob({
      type: 'contract-summary',
      messageVersion: 1,
      contractId: 'contract-1',
      documentId: 'document-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      reason: 'webhook',
    });

    expect(result).toEqual({ status: 'ok' });
    const summaryCallInput =
      hoistedSummary.generateContractSummaryForContractMock.mock.calls[0]?.[0];
    expect(summaryCallInput.contract.relatedTransactionIds).toBeUndefined();
    expect(summaryCallInput.contract.relatedHoldIds).toBeUndefined();
  });

  it('skips delayed DOCUMENT_CREATED jobs after newer epochs already won', async () => {
    summaryInputStore.get.mockResolvedValue({
      contractId: 'contract-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z#-1',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      sourceEpoch: -1,
      contractSnapshot: {
        contractId: 'contract-1',
        typeBlueId: 'PayNote/PayNote',
        displayName: 'PayNote',
        document: { name: 'Snapshot state' },
        userId: 'user-1',
        status: 'reserved',
        updatedAt: '2026-02-08T10:00:00.000Z',
        createdAt: '2026-02-08T09:00:00.000Z',
      },
      createdAt: '2026-02-08T10:00:00.000Z',
    });

    contractRepository.getContract.mockResolvedValue({
      contractId: 'contract-1',
      typeBlueId: 'PayNote/PayNote',
      displayName: 'PayNote',
      document: { name: 'Latest state' },
      userId: 'user-1',
      status: 'reserved',
      updatedAt: '2026-02-08T10:00:05.000Z',
      summarySourceUpdatedAt: '2026-02-08T10:00:05.000Z',
      summarySourceEpoch: 2,
      createdAt: '2026-02-08T09:00:00.000Z',
    });

    const conditionalFailure = Object.assign(
      new Error('The conditional request failed'),
      {
        name: 'ConditionalCheckFailedException',
      }
    );
    hoistedSummary.generateContractSummaryForContractMock.mockRejectedValueOnce(
      conditionalFailure
    );

    const result = await handleSummaryJob({
      type: 'contract-summary',
      messageVersion: 1,
      contractId: 'contract-1',
      documentId: 'document-1',
      summaryInputKey: 'SUMMARY_INPUT#2026-02-08T10:00:00.000Z#-1',
      sourceUpdatedAt: '2026-02-08T10:00:00.000Z',
      sourceEpoch: -1,
      reason: 'webhook',
    });

    expect(result).toEqual({ status: 'stale' });
    expect(logger.info).toHaveBeenCalledWith(
      'Skipping stale contract summary job',
      expect.objectContaining({
        contractId: 'contract-1',
        sourceEpoch: -1,
        latestSummarySourceEpoch: 2,
      })
    );
  });
});
