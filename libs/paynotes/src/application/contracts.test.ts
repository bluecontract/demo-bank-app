import { describe, expect, it, vi } from 'vitest';
import { BlueNode } from '@blue-labs/language';
import { blueIds } from '@blue-repository/types/packages/paynote/blue-ids';
import type {
  ContractRecord,
  ContractRepository,
} from '@demo-bank-app/contracts';
import { blue } from '../blue';
import { upsertContractRecord } from './contracts';
import { toCompactBlueJsonValue } from './blue/compactBlue';

const now = '2024-01-01T00:00:00.000Z';
const payNoteDocument = {
  type: 'PayNote/PayNote',
  name: 'Test PayNote',
};

const createContractRepository = () => {
  const repository = {
    getContractByDocumentId: vi.fn().mockResolvedValue(null),
    getContractBySessionId: vi.fn().mockResolvedValue(null),
    claimCanonicalSessionByDocumentId: vi
      .fn()
      .mockImplementation(async ({ sessionId }: { sessionId: string }) => ({
        canonicalContractId: sessionId,
        isCanonicalOwner: true,
      })),
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
    expect(mocks.claimCanonicalSessionByDocumentId).toHaveBeenCalledWith({
      documentId: 'doc-1',
      sessionId: 'session-1',
      createdAt: now,
    });
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
    expect(mocks.claimCanonicalSessionByDocumentId).toHaveBeenCalledWith({
      documentId: 'doc-1',
      sessionId: 'session-1',
      createdAt: now,
    });
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
    expect(mocks.claimCanonicalSessionByDocumentId).not.toHaveBeenCalled();
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

  it('links non-canonical session id and updates canonical contract when document already exists', async () => {
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
    expect(mocks.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'session-1',
        sessionId: 'session-1',
        documentId: 'doc-1',
      })
    );
    expect(mocks.claimCanonicalSessionByDocumentId).not.toHaveBeenCalled();
  });

  it('links session and skips save when canonical claim lost', async () => {
    const { repository, mocks } = createContractRepository();
    mocks.claimCanonicalSessionByDocumentId.mockResolvedValue({
      canonicalContractId: 'session-1',
      isCanonicalOwner: false,
    });

    const result = await upsertContractRecord({
      contractRepository: repository,
      document: payNoteDocument,
      sessionId: 'session-2',
      documentId: 'doc-1',
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      eventEpoch: 0,
      now,
    });

    expect(result).toBe('session-1');
    expect(mocks.saveContract).not.toHaveBeenCalled();
    expect(mocks.linkSessionToContract).toHaveBeenCalledWith({
      sessionId: 'session-2',
      contractId: 'session-1',
      createdAt: now,
    });
  });

  it('tolerates link conflicts when shadow session is already mapped to the same document', async () => {
    const { repository, mocks } = createContractRepository();
    mocks.getContractByDocumentId.mockResolvedValue(buildExistingContract());
    mocks.linkSessionToContract.mockRejectedValue(
      Object.assign(new Error('conditional failed'), {
        name: 'ConditionalCheckFailedException',
      })
    );
    mocks.getContractBySessionId.mockResolvedValue({
      contractId: 'session-shadow',
      typeBlueId: 'blue-id',
      displayName: 'PayNote',
      sessionId: 'session-2',
      documentId: 'doc-1',
      document: payNoteDocument,
      createdAt: now,
      updatedAt: now,
    });

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
    expect(mocks.getContractBySessionId).toHaveBeenCalledWith('session-2');
    expect(mocks.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'session-1',
        sessionId: 'session-1',
        documentId: 'doc-1',
      })
    );
  });

  it('rethrows link conflicts when shadow session is stuck on a provisional self-mapping', async () => {
    const { repository, mocks } = createContractRepository();
    mocks.getContractByDocumentId.mockResolvedValue(buildExistingContract());
    mocks.linkSessionToContract.mockRejectedValue(
      Object.assign(new Error('conditional failed'), {
        name: 'ConditionalCheckFailedException',
      })
    );
    mocks.getContractBySessionId.mockResolvedValue({
      contractId: 'session-2',
      typeBlueId: 'blue-id',
      displayName: 'PayNote Delivery',
      sessionId: 'session-2',
      documentName: 'Pending Delivery',
      customerChannelKey: 'payNoteDeliverer',
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      upsertContractRecord({
        contractRepository: repository,
        document: payNoteDocument,
        sessionId: 'session-2',
        documentId: 'doc-1',
        eventType: 'DOCUMENT_EPOCH_ADVANCED',
        eventEpoch: 3,
        now,
      })
    ).rejects.toMatchObject({
      name: 'ConditionalCheckFailedException',
    });
    expect(mocks.getContractBySessionId).toHaveBeenCalledWith('session-2');
  });

  it('tolerates canonical-claim link conflicts when shadow session is already mapped to the same document', async () => {
    const { repository, mocks } = createContractRepository();
    mocks.claimCanonicalSessionByDocumentId.mockResolvedValue({
      canonicalContractId: 'session-1',
      isCanonicalOwner: false,
    });
    mocks.linkSessionToContract.mockRejectedValue(
      Object.assign(new Error('conditional failed'), {
        name: 'ConditionalCheckFailedException',
      })
    );
    mocks.getContractBySessionId.mockResolvedValue({
      contractId: 'session-shadow',
      typeBlueId: 'blue-id',
      displayName: 'PayNote',
      sessionId: 'session-2',
      documentId: 'doc-1',
      document: payNoteDocument,
      createdAt: now,
      updatedAt: now,
    });

    const result = await upsertContractRecord({
      contractRepository: repository,
      document: payNoteDocument,
      sessionId: 'session-2',
      documentId: 'doc-1',
      eventType: 'DOCUMENT_EPOCH_ADVANCED',
      eventEpoch: 0,
      now,
    });

    expect(result).toBe('session-1');
    expect(mocks.getContractBySessionId).toHaveBeenCalledWith('session-2');
    expect(mocks.saveContract).not.toHaveBeenCalled();
  });

  it('stores contract payload fields in compact format', async () => {
    const { repository, mocks } = createContractRepository();
    const resolvedType = new BlueNode()
      .setBlueId(blueIds['PayNote/PayNote'])
      .setName('Resolved PayNote Type')
      .addProperty('details', new BlueNode().setValue('expanded'));
    const expandedPayload = blue.nodeToJson(
      new BlueNode()
        .setType(resolvedType)
        .addProperty('marker', new BlueNode().setValue('value')),
      'official'
    ) as Record<string, unknown>;

    const document = {
      ...payNoteDocument,
      debugPayload: expandedPayload,
    };
    const triggerEvent = {
      ...expandedPayload,
      type: 'PayNote/Linked Card Charge Requested',
    };
    const emittedEvents = [triggerEvent];
    const compactEmittedEventsRaw = toCompactBlueJsonValue(emittedEvents);
    const compactEmittedEvents = Array.isArray(compactEmittedEventsRaw)
      ? compactEmittedEventsRaw
      : typeof compactEmittedEventsRaw === 'object' &&
        compactEmittedEventsRaw !== null &&
        Array.isArray(
          (compactEmittedEventsRaw as Record<string, unknown>).items
        )
      ? ((compactEmittedEventsRaw as Record<string, unknown>)
          .items as unknown[])
      : emittedEvents;

    const result = await upsertContractRecord({
      contractRepository: repository,
      document,
      sessionId: 'session-compact',
      documentId: 'doc-compact',
      eventType: 'DOCUMENT_CREATED',
      triggerEvent,
      emittedEvents,
      now,
    });

    expect(result).toBe('session-compact');
    expect(mocks.saveContract).toHaveBeenCalledWith(
      expect.objectContaining({
        document: toCompactBlueJsonValue(document),
        triggerEvent: toCompactBlueJsonValue(triggerEvent),
        emittedEvents: compactEmittedEvents,
      })
    );
  });
});
