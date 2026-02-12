import { describe, expect, it, vi } from 'vitest';
import type {
  ContractRecord,
  ContractRepository,
} from '@demo-bank-app/contracts';
import { upsertContractRecord } from './contracts';

const now = '2024-01-01T00:00:00.000Z';
const payNoteDocument = {
  type: 'PayNote/PayNote',
  name: 'Test PayNote',
};

const createContractRepository = () => {
  const repository = {
    getContractByDocumentId: vi.fn().mockResolvedValue(null),
    linkSessionToContract: vi.fn().mockResolvedValue(undefined),
    getContract: vi.fn().mockResolvedValue(null),
    saveContract: vi.fn().mockResolvedValue(undefined),
  };

  return {
    repository: repository as unknown as ContractRepository,
    mocks: repository,
  };
};

const buildExistingContract = (): ContractRecord => ({
  contractId: 'session-1',
  typeBlueId: 'blue-id',
  displayName: 'PayNote',
  sessionId: 'session-1',
  documentId: 'doc-1',
  document: payNoteDocument,
  pendingActions: [
    {
      actionId: 'monitoring-1:consent',
      type: 'monitoringConsentApproval',
      status: 'pending',
      title: 'Allow monitoring',
      targetMerchantId: 'merchant-1',
      requestedEvents: ['transaction'],
      createdAt: now,
    },
  ],
  monitoringSubscriptions: [
    {
      subscriptionId: 'monitoring-1',
      targetMerchantId: 'merchant-1',
      requestedEvents: ['transaction'],
      status: 'pending',
      pendingActionId: 'monitoring-1:consent',
      requestEventId: 'event-1',
      requestEventIndex: 0,
      createdAt: now,
      updatedAt: now,
    },
  ],
  createdAt: now,
  updatedAt: now,
});

describe('upsertContractRecord', () => {
  it('creates a contract for DOCUMENT_CREATED when record is missing', async () => {
    const { repository, mocks } = createContractRepository();

    const result = await upsertContractRecord({
      contractRepository: repository,
      document: payNoteDocument,
      sessionId: 'session-1',
      documentId: 'doc-1',
      eventType: 'DOCUMENT_CREATED',
      now,
    });

    expect(result).toBe('session-1');
    expect(mocks.saveContract).toHaveBeenCalledTimes(1);
  });

  it('creates a contract for DOCUMENT_EPOCH_ADVANCED when epoch is 0', async () => {
    const { repository, mocks } = createContractRepository();

    const result = await upsertContractRecord({
      contractRepository: repository,
      document: payNoteDocument,
      sessionId: 'session-1',
      documentId: 'doc-1',
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      eventEpoch: 0,
      now,
    });

    expect(result).toBe('session-1');
    expect(mocks.saveContract).toHaveBeenCalledTimes(1);
  });

  it('skips create for DOCUMENT_EPOCH_ADVANCED when epoch is greater than 0', async () => {
    const { repository, mocks } = createContractRepository();

    const result = await upsertContractRecord({
      contractRepository: repository,
      document: payNoteDocument,
      sessionId: 'session-1',
      documentId: 'doc-1',
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      eventEpoch: 2,
      now,
    });

    expect(result).toBeNull();
    expect(mocks.saveContract).not.toHaveBeenCalled();
  });

  it('updates an existing contract for DOCUMENT_EPOCH_ADVANCED even when epoch is greater than 0', async () => {
    const { repository, mocks } = createContractRepository();
    mocks.getContract.mockResolvedValue(buildExistingContract());

    const result = await upsertContractRecord({
      contractRepository: repository,
      document: payNoteDocument,
      sessionId: 'session-1',
      documentId: 'doc-1',
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      eventEpoch: 3,
      status: 'processed',
      now,
    });

    expect(result).toBe('session-1');
    expect(mocks.saveContract).toHaveBeenCalledTimes(1);
    expect(mocks.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingActions: expect.arrayContaining([
          expect.objectContaining({
            actionId: 'monitoring-1:consent',
            status: 'pending',
          }),
        ]),
        monitoringSubscriptions: expect.arrayContaining([
          expect.objectContaining({
            subscriptionId: 'monitoring-1',
            status: 'pending',
          }),
        ]),
      })
    );
  });

  it('links non-canonical session id when document already exists', async () => {
    const { repository, mocks } = createContractRepository();
    mocks.getContractByDocumentId.mockResolvedValue(buildExistingContract());

    const result = await upsertContractRecord({
      contractRepository: repository,
      document: payNoteDocument,
      sessionId: 'session-2',
      documentId: 'doc-1',
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      eventEpoch: 3,
      now,
    });

    expect(result).toBe('session-1');
    expect(mocks.linkSessionToContract).toHaveBeenCalledWith({
      sessionId: 'session-2',
      contractId: 'session-1',
      createdAt: now,
    });
    expect(mocks.saveContract).not.toHaveBeenCalled();
  });
});
